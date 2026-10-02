-- us STEP 3D fix: qualify pgcrypto call in get_or_create_invite().
--
-- ROOT CAUSE (diagnosed 2026-10-02): GET /api/invite returned HTTP 500
-- ("Could not create invite.") because the function body called
-- gen_random_bytes() unqualified while the function's
-- search_path = public does not include the schema that holds pgcrypto on
-- the hosted project (standard Supabase extension schema: extensions).
-- Every call therefore raised PostgreSQL 42883
-- (function gen_random_bytes(integer) does not exist), and the route maps
-- any rpcError to 500. This is the same class of issue previously fixed for
-- resolve_login_email() (crypt()/gen_salt() -> extensions.*).
--
-- Schema verification (no assumption): crypt(), gen_salt(), and
-- gen_random_bytes() are all objects of the SAME pgcrypto extension, so they
-- necessarily live in the same schema. The login fix already established on
-- this hosted project that extensions.crypt() / extensions.gen_salt()
-- resolve, hence pgcrypto is installed in extensions, hence
-- extensions.gen_random_bytes(integer) is the correct qualification.
-- encode() needs no change (pg_catalog, always visible); auth.uid() and all
-- table references are already schema-qualified and unaffected by
-- search_path.
--
-- FIX SCOPE — two minimal changes inside public.get_or_create_invite() only:
-- 1. gen_random_bytes(16) -> extensions.gen_random_bytes(16). Token format
--    unchanged: 16 cryptographically random bytes, hex encoded, 32 chars.
-- 2. ON CONFLICT DO UPDATE SET token = excluded.token -> DO NOTHING.
--    The previous line was NOT the no-op its comment claimed: excluded.token
--    is the newly generated random token, so every GET /api/invite rotated
--    the user's invite token, contradicting the route contract ("stable
--    invite URL") and the function's own comment. DO NOTHING activates the
--    already-written fallback SELECT below (dead code until now), which
--    returns the existing stable token. The ON CONFLICT arbiter
--    (inviter_user_id WHERE disabled_at IS NULL, i.e. the one-active-invite-
--    per-user partial unique index) is unchanged.
-- Everything else is preserved exactly: SECURITY DEFINER,
-- SET search_path = public (unchanged on purpose — direct qualification is
-- preferred over widening search_path), signature (no args), return type
-- (table(token text, invite_url text)), '/invite/' || token URL shape,
-- one invite per user, partial unique constraint reliance, stable token,
-- REVOKE FROM anon/authenticated + GRANT EXECUTE to authenticated. No table
-- changes, no RLS changes, no new privileges, no extension creation
-- (pgcrypto is already installed on the hosted project).
-- resolve_invite_token() and record_referral() make no pgcrypto calls and
-- are untouched.
create or replace function public.get_or_create_invite()
returns table (token text, invite_url text) language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_inviter_id uuid := auth.uid();
begin
  -- Try to insert a new invite; if one already exists (active), keep it
  insert into public.invites (inviter_user_id, token)
  values (v_inviter_id, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (inviter_user_id) where disabled_at is null
  do nothing
  returning token into v_token;

  -- If the insert didn't return (conflict on existing active invite), fetch it
  if v_token is null then
    select token into v_token
    from public.invites
    where inviter_user_id = v_inviter_id
      and disabled_at is null
    limit 1;
  end if;

  return query select v_token, '/invite/' || v_token;
end; $$;

revoke all on function public.get_or_create_invite() from anon, authenticated;
grant execute on function public.get_or_create_invite() to authenticated;
