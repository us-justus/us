-- Admin spot-allocation exclusion (defense in depth).
--
-- CONTEXT: the admin account once completed normal student onboarding and
-- consumed a student waitlist spot (spot #2). The primary guard lives in
-- POST /api/onboarding/profile (is_admin() check before any allocation).
-- This migration closes the remaining gap: allocate_campus_spot() itself
-- refuses admin callers, so no current or future allocator caller — nor a
-- membership granted between the route check and the allocate call — can
-- consume a student spot number or claim row for an admin identity.
--
-- SCOPE (narrow by construction):
--   - One function redefined: public.allocate_campus_spot(). The atomic
--     UPDATE ... RETURNING allocation, the campus_spot_claims idempotency
--     (return existing claim, ON CONFLICT DO NOTHING), and the EXECUTE grant
--     to authenticated only (revoked from public/anon) are preserved exactly.
--   - The refusal uses the existing public.is_admin() (auth.uid()-based,
--     SECURITY DEFINER-safe: the caller's JWT is preserved inside SECURITY
--     DEFINER functions, the same basis as the moderation RPCs). It raises
--     42501, the same errcode the route surfaces as a 403-class denial.
--   - No table changes, no RLS/policy changes, no grant changes, no data
--     changes, no allocator reset, no admin_users change, no login-flow change.
--   - Admin login never calls this function (sole caller is the onboarding
--     profile route), so /inside access is unaffected.

create or replace function public.allocate_campus_spot()
returns int language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
declare v_user uuid := auth.uid(); v_spot int;
begin
  if v_user is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  if public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select spot into v_spot from public.campus_spot_claims where user_id = v_user;
  if v_spot is not null then return v_spot; end if;
  update public.campus_spot_allocator set next_spot = next_spot + 1 where id = 1 returning next_spot - 1 into v_spot;
  if v_spot is null then raise exception 'allocator unavailable'; end if;
  insert into public.campus_spot_claims(user_id, spot) values (v_user, v_spot) on conflict (user_id) do nothing;
  select spot into v_spot from public.campus_spot_claims where user_id = v_user;
  return v_spot;
end; $$;

revoke all on function public.allocate_campus_spot() from public, anon;
grant execute on function public.allocate_campus_spot() to authenticated;

comment on function public.allocate_campus_spot() is
  'Atomic student waitlist-spot allocation (idempotent per user via campus_spot_claims). Refuses admin callers (is_admin(), 42501) so admins never consume a student spot. Authenticated callers only.';
