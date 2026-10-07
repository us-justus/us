-- Onboarding email save RPC (regression fix for 20261019000001).
--
-- CONTEXT: 20261019000001 intentionally blocked direct authenticated-client
-- writes to verification_records.email via the
-- trg_guard_verification_email_identity trigger (changing email through
-- PostgREST must never retain prior trust). The onboarding email route used
-- an authenticated upsert, so production now fails with "Could not save
-- email." This migration restores ONLY that one onboarding write through a
-- narrowly scoped SECURITY DEFINER RPC. Direct PostgREST writes stay
-- blocked; no table grants are changed.
--
-- SCOPE (narrow by construction):
--   - One function, one argument: save_onboarding_email(p_email text).
--   - Target user is derived EXCLUSIVELY from auth.uid() (the caller's
--     session). No user_id argument exists, so a caller cannot name another
--     user's row.
--   - Only these columns are ever written: email, email_skipped (= false),
--     email_verified_at (cleared to NULL when the address changes, preserved
--     when the same address is re-submitted). usn, verification_status,
--     legacy email_verified, and all other columns are untouched.
--   - auth.uid() NULL (no session) raises 42501.
--   - Basic email shape/length check mirrors validateAccountEmail()
--     (defense-in-depth; the route still validates first).
--   - Fixed safe search_path; EXECUTE granted to authenticated only
--     (revoked from PUBLIC/anon). No generic verification_records updater.
--
-- TRIGGER INTERACTION: both verification_records guards inspect
-- auth.role()/auth.uid(), which still read the CALLER's JWT inside a
-- SECURITY DEFINER call — so the RPC's own write would be rejected as a
-- direct write without an exemption. The exemption below keys on
-- current_user instead: direct PostgREST writes run as the `authenticated`
-- / `anon` roles, while SECURITY DEFINER RPCs (and service_role server
-- paths) run as the function owner / service_role. Authenticated clients
-- cannot spoof current_user (no DDL privilege), so direct writes stay
-- blocked and only trusted server-side functions can write through.
-- service_role behavior is unchanged (already allowed via auth.role()).

-- 1. Let trusted SECURITY DEFINER server paths through the email-identity
-- guard; direct authenticated/anon PostgREST writes stay blocked.
create or replace function public.guard_verification_email_identity()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, auth, pg_temp as $$
begin
  -- Trusted server path: SECURITY DEFINER RPCs execute as the function
  -- owner (never `authenticated`/`anon`); service_role server writes run as
  -- `service_role`. Neither can be spoofed by a PostgREST caller.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if auth.role() in ('service_role', 'supabase_admin') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.email is distinct from old.email then
    raise exception 'verification email is server-managed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.email is not null then
    raise exception 'verification email is server-managed' using errcode = '42501';
  end if;
  return new;
end; $$;

-- 2. Same exemption for the trust-timestamp guard so the RPC can CLEAR
-- trust (set NULL) when the address changes. Direct authenticated writes to
-- email_verified_at stay blocked; the RPC below only ever clears (never
-- sets) the timestamp.
create or replace function public.guard_email_verified_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_role text;
begin
  -- Trusted server path (see above): definer/owner + service_role writes
  -- pass; direct authenticated/anon PostgREST writes fall through to the
  -- role check below.
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.email_verified_at is not distinct from OLD.email_verified_at then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.email_verified_at is null then
    return NEW;
  end if;
  begin
    v_role := auth.role();
  exception when others then
    v_role := null;
  end;
  if v_role is null or v_role = 'service_role' then
    return NEW;
  end if;
  raise exception 'email_verified_at is server-managed';
end;
$$;

-- 3. The narrow onboarding email writer. One email argument, caller-owned
-- row only, trust cleared on address change.
create or replace function public.save_onboarding_email(p_email text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := trim(coalesce(p_email, ''));
begin
  if v_user is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  if char_length(v_email) < 3 or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email.' using errcode = '22023';
  end if;
  insert into public.verification_records(user_id, email, email_skipped, email_verified_at)
  values (v_user, v_email, false, null)
  on conflict (user_id) do update set
    email = excluded.email,
    email_skipped = false,
    email_verified_at = case
      when lower(coalesce(public.verification_records.email, '')) = lower(excluded.email)
      then public.verification_records.email_verified_at
      else null
    end;
end;
$$;

revoke all on function public.save_onboarding_email(text) from public, anon;
grant execute on function public.save_onboarding_email(text) to authenticated;

comment on function public.save_onboarding_email(text) is
  'Onboarding-only email save: caller-owned verification_records row (auth.uid(), no user_id argument); sets email + email_skipped=false, clears email_verified_at on address change. Authenticated callers only; direct PostgREST email writes remain blocked.';
