-- us STEP 3C: email becomes OPTIONAL. No fake emails, ever.
--
-- PART 1 — email skip marker (flow state only, not identity)
-- verification_records.email is already nullable, so a missing email needs no
-- schema change. What needs persisting is the DECISION: "USN verified, email
-- deliberately skipped" vs "email step not reached yet". Without it the state
-- machine cannot tell skip from pending and refresh/back would loop to email.
alter table public.verification_records
  add column if not exists email_skipped boolean not null default false;
comment on column public.verification_records.email_skipped is
  'Onboarding flow state: USN verified, email deliberately skipped. Identity stays auth.users.id; no fake email is ever synthesized.';

-- No RLS change: the existing own-row SELECT/INSERT/UPDATE policies on
-- verification_records already cover the new column. No new policy, no
-- weakening, no anon access, no service-role grant.

-- PART 2 — password-gated USN -> auth-email resolution for login
-- Login is USN + password (email does not exist for every student), but
-- Supabase Auth signInWithPassword requires the auth email identifier.
-- This function is the smallest secure internal mapping:
--   (USN, password_attempt) -> auth email ONLY when the password verifies.
-- - SECURITY DEFINER so it can run pre-login (callers hold no session and
--   RLS gives anon no access to verification_records). It performs its own
--   bcrypt check with pgcrypto crypt() against auth.users.encrypted_password
--   (READ-ONLY; auth.users is never written by this project).
-- - Returns NULL for: unknown USN, no auth email (no-email account), no
--   password set, or wrong password — all indistinguishable to the caller.
-- - A dummy bcrypt burn on the miss path keeps timing from separating
--   "USN unknown" from "password wrong". (USN existence is already revealed
--   by the onboarding duplicate-USN error, so nothing new leaks either way.)
-- - The email result must NEVER be returned to a browser client. The only
--   sanctioned caller is POST /api/auth/login, which uses it server-side for
--   signInWithPassword and returns { ok, next } only.
-- - Grants are explicit: REVOKE from PUBLIC first (functions are PUBLIC by
--   default), then grant to anon + authenticated (pre-login callers present
--   the anon role). No table grants change; no service role involved.
create or replace function public.resolve_login_email(p_usn text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_usn text := upper(regexp_replace(coalesce(trim(p_usn), ''), '\s+', '', 'g'));
  v_email text;
  v_hash text;
begin
  if v_usn = '' or p_password is null or p_password = '' then
    return null;
  end if;

  select u.email, u.encrypted_password
    into v_email, v_hash
    from public.verification_records vr
    join auth.users u on u.id = vr.user_id
   where vr.usn = v_usn;

  if v_email is null or v_hash is null or v_hash = '' then
    -- Unknown USN, no-email account, or no password: burn comparable work
    -- so the miss path does not time differently from a real bcrypt check.
    perform crypt(p_password, gen_salt('bf', 10));
    return null;
  end if;

  if crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;
  return null;
end;
$$;

revoke all on function public.resolve_login_email(text, text) from public;
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;

comment on function public.resolve_login_email(text, text) is
  'STEP 3C login mapping: returns the auth email for a USN only when the password verifies, else NULL. Server-route use only; never expose the result to clients.';
