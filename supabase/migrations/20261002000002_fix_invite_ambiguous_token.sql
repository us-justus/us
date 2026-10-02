-- us STEP 3D hotfix: resolve ambiguous `token` in get_or_create_invite().
--
-- ROOT CAUSE (diagnosed 2026-10-02): after the pgcrypto fix, GET /api/invite
-- returned HTTP 500 with PostgreSQL 42702 (column reference "token" is
-- ambiguous). The function declares RETURNS TABLE (token text, ...), so
-- `token` is simultaneously a PL/pgSQL output variable and the column
-- public.invites.token. In the fallback query
--   select token into v_token from public.invites ...
-- PostgreSQL cannot determine whether `token` means the output variable or
-- the table column and raises 42702. This branch runs exactly when the user
-- already has an active invite (INSERT took the ON CONFLICT DO NOTHING
-- path), i.e. on every repeat GET /api/invite.
--
-- Evidence the INSERT...RETURNING path is NOT affected: the earlier 42883
-- fired from inside that same INSERT statement, which proves it parses and
-- plans cleanly (a 42702 parse error would have fired before any execution).
-- A row was created through it, so only the fallback SELECT is ambiguous.
--
-- FIX SCOPE — one change inside public.get_or_create_invite() only: the
-- fallback SELECT now reads select i.token ... from public.invites as i
-- with all column references qualified (i.inviter_user_id, i.disabled_at),
-- so no identifier can resolve to the OUT variable anymore.
-- Everything else is preserved exactly as currently deployed:
-- SECURITY DEFINER, SET search_path = public (unchanged on purpose),
-- extensions.gen_random_bytes(16) + encode(..., 'hex') (16 random bytes,
-- 32-char hex token, unchanged), ON CONFLICT DO NOTHING on the partial
-- unique index (one active invite per user), stable token via the fallback
-- fetch, return type table(token text, invite_url text),
-- '/invite/' || v_token URL shape, REVOKE FROM anon/authenticated +
-- GRANT EXECUTE to authenticated. No table changes, no RLS changes, no new
-- privileges, no extension creation, no search_path change.
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

  -- If the insert didn't return (conflict on existing active invite), fetch it.
  -- All column references are table-qualified: `token` alone would be
  -- ambiguous with this function's RETURNS TABLE (token, ...) output
  -- variable (PostgreSQL 42702).
  select i.token
  into v_token
  from public.invites as i
  where i.inviter_user_id = v_inviter_id
    and i.disabled_at is null
  limit 1;

  return query select v_token, '/invite/' || v_token;
end; $$;

revoke all on function public.get_or_create_invite() from anon, authenticated;
grant execute on function public.get_or_create_invite() to authenticated;
