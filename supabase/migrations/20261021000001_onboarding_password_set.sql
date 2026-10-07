-- Onboarding password-setup gate (fixes verification-link bounce).
--
-- BUG: a verified email alone was sufficient to exit the password step, so
-- /onboarding/password?verified=1 resolved to "profile" and users completed
-- profile/photos without ever setting a password.
--
-- FIX (additive, server-owned):
--   - verification_records.password_set_at — set ONLY via the narrow RPC
--     below after the client proves a password write via
--     supabase.auth.updateUser({ password }).
--   - getOnboardingState(): verified email + password_set_at NULL + no
--     profile → "password". Grandfather: an existing profile never returns
--     to "password".
--
-- SCOPE (narrow by construction):
--   - One column, one function, zero arguments:
--     record_onboarding_password().
--   - Target user derived EXCLUSIVELY from auth.uid(). No user_id argument,
--     no password argument (the password hash is written by Supabase Auth,
--     never sent to this RPC).
--   - Only password_set_at is ever written. email, email_verified_at, usn,
--     verification_status, and all other columns are untouched.
--   - auth.uid() NULL raises 42501.
--   - Fixed safe search_path; EXECUTE granted to authenticated only
--     (revoked from PUBLIC/anon). No generic verification_records updater.
--
-- TRIGGER INTERACTION: guard_verification_email_identity() and
-- guard_email_verified_at() only react to email / email_verified_at changes,
-- so a password_set_at-only UPDATE passes through them. The new
-- guard_password_set_at() below blocks direct authenticated/anon PostgREST
-- writes to password_set_at; the SECURITY DEFINER RPC (current_user = owner)
-- and service_role server paths pass. Authenticated clients cannot spoof
-- current_user (no DDL privilege), so only the trusted RPC can record the
-- timestamp.

-- 1. Additive timestamp column.
alter table public.verification_records
  add column if not exists password_set_at timestamptz;

comment on column public.verification_records.password_set_at is
  'Password-setup proof: non-null means the user completed the onboarding password step (Supabase Auth password write + this RPC). Server-managed only — direct client writes rejected by guard_password_set_at(). Distinct from email verification (email_verified_at).';

-- 2. Guard: password_set_at is server-managed. Direct authenticated/anon
-- PostgREST writes are rejected; trusted SECURITY DEFINER RPCs (running as
-- the function owner, never `authenticated`/`anon`) and service_role pass.
create or replace function public.guard_password_set_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_role text;
begin
  if TG_OP = 'UPDATE' and NEW.password_set_at is not distinct from OLD.password_set_at then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.password_set_at is null then
    return NEW;
  end if;
  -- Trusted server path: SECURITY DEFINER RPCs execute as the function
  -- owner (never `authenticated`/`anon`); service_role server writes run as
  -- `service_role`. Neither can be spoofed by a PostgREST caller.
  if current_user not in ('authenticated', 'anon') then
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
  raise exception 'password_set_at is server-managed';
end;
$$;

drop trigger if exists trg_guard_password_set_at_ins on public.verification_records;
create trigger trg_guard_password_set_at_ins
  before insert on public.verification_records
  for each row execute function public.guard_password_set_at();

drop trigger if exists trg_guard_password_set_at_upd on public.verification_records;
create trigger trg_guard_password_set_at_upd
  before update on public.verification_records
  for each row execute function public.guard_password_set_at();

revoke all on function public.guard_password_set_at() from public, anon, authenticated;

-- 3. The narrow password-completion recorder. Zero arguments, caller-owned
-- row only, password_set_at only — never establishes email verification.
create or replace function public.record_onboarding_password()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  update public.verification_records
     set password_set_at = coalesce(password_set_at, now())
   where user_id = v_user;
end;
$$;

revoke all on function public.record_onboarding_password() from public, anon;
grant execute on function public.record_onboarding_password() to authenticated;

comment on function public.record_onboarding_password() is
  'Onboarding-only password completion: caller-owned verification_records row (auth.uid(), no user_id argument, no password argument); sets password_set_at only, preserves first-set timestamp, never touches email/email_verified_at. Authenticated callers only; direct PostgREST password_set_at writes remain blocked.';
