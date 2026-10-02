-- us STEP 3D hotfix (part 2): qualify RETURNING token in get_or_create_invite().
--
-- FOLLOW-UP (diagnosed 2026-10-02): after the fallback-SELECT qualification,
-- GET /api/invite still returned HTTP 500 with PostgreSQL 42702
-- (column reference "token" is ambiguous) — including for users with NO
-- invite row, whose calls never reach the fallback SELECT. The same
-- collision exists in the INSERT's RETURNING clause:
--   insert into public.invites ... returning token into v_token
-- `token` is simultaneously this function's RETURNS TABLE (token, ...)
-- output variable and the public.invites.token column, so the RETURNING
-- list is ambiguous as well. (The earlier 42883 had masked this: execution
-- failed inside VALUES before the ambiguity surfaced on this path.)
--
-- FIX SCOPE — inside public.get_or_create_invite() only:
-- 1. The INSERT now aliases its target (public.invites as i) and returns
--    returning i.token into v_token — unambiguously the table column.
-- 2. The fallback SELECT keeps the part-1 qualification verbatim
--    (select i.token ... from public.invites as i with qualified predicates),
--    so this migration is complete on its own regardless of apply order.
-- Everything else is preserved exactly: SECURITY DEFINER,
-- SET search_path = public (unchanged on purpose),
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
  -- Try to insert a new invite; if one already exists (active), keep it.
  -- Target aliased so RETURNING unambiguously reads the table column:
  -- bare `token` would collide with this function's RETURNS TABLE
  -- (token, ...) output variable (PostgreSQL 42702).
  insert into public.invites as i (inviter_user_id, token)
  values (v_inviter_id, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (inviter_user_id) where disabled_at is null
  do nothing
  returning i.token into v_token;

  -- If the insert didn't return (conflict on existing active invite), fetch it.
  -- All column references are table-qualified for the same reason (42702).
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
