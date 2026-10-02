-- us STEP 3C fix: qualify pgcrypto calls in resolve_login_email().
--
-- ROOT CAUSE (diagnosed 2026-10-01): every login returned
-- "Sign-in is unavailable right now." (HTTP 503) because the function body
-- called crypt()/gen_salt() unqualified while the function's
-- search_path = public, auth, pg_temp does not include the schema that holds
-- pgcrypto on the hosted project (standard Supabase extension schema:
-- extensions). Every call therefore raised PostgreSQL 42883
-- (function gen_salt(unknown, integer) does not exist) before password
-- verification, and POST /api/auth/login maps any rpcError to 503.
--
-- FIX SCOPE — the ONLY functional change in this migration is schema-
-- qualifying the two pgcrypto call sites as extensions.crypt() /
-- extensions.gen_salt(). Everything else is preserved exactly:
-- SECURITY DEFINER, SET search_path = public, auth, pg_temp (unchanged on
-- purpose — direct qualification is preferred over widening search_path),
-- USN normalization, bcrypt verification semantics, dummy burn on the miss
-- path, NULL-on-all-failures, return type (text), parameter names/types
-- (p_usn text, p_password text), REVOKE FROM PUBLIC, GRANT EXECUTE to
-- anon + authenticated. No table changes, no RLS changes, no auth.users
-- writes, no new privileges, no extension creation (pgcrypto is already
-- installed on the hosted project).
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
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10));
    return null;
  end if;

  if extensions.crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;
  return null;
end;
$$;

revoke all on function public.resolve_login_email(text, text) from public;
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;

comment on function public.resolve_login_email(text, text) is
  'STEP 3C login mapping: returns the auth email for a USN only when the password verifies, else NULL. Server-route use only; never expose the result to clients.';
