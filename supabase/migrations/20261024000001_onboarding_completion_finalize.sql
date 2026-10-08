-- Spot-completion finalization (allocate at durable completion, not creation).
--
-- CONTEXT: POST /api/onboarding/profile used to call allocate_campus_spot()
-- before the profile upsert, so every profile-only account (zero photos)
-- consumed a permanent sequential spot while still incomplete. Waiting
-- eligibility (get_waitlist_count: active + >=1 photo) already excluded those
-- rows, so allocation and waiting disagreed. The permanent spot is an
-- entry/completion number: it must be minted only after the completion tail
-- (owned profile + at least one durable profile_photos row) is satisfied.
--
-- SCOPE (additive only):
--   - One function added: public.finalize_onboarding_completion(). Returns
--     jsonb {spot, already_allocated}.
--   - Reuses public.allocate_campus_spot() via a nested SECURITY DEFINER
--     call instead of duplicating allocator logic. The caller's auth.uid()
--     JWT is preserved inside SECURITY DEFINER functions (same basis as the
--     moderation RPCs), so ownership, admin refusal, claim idempotency, the
--     atomic UPDATE ... RETURNING row lock, and the monotonic next_spot
--     counter are all preserved exactly.
--   - The verify + allocate + persist unit runs inside this function's single
--     implicit transaction: a normal successful completion cannot be left in
--     photos >= 1 + spot NULL. Concurrent finalizes serialize on the
--     allocator row and the profile row; the loser's UPDATE touches zero
--     rows (WHERE spot IS NULL re-evaluated after the row lock) and the
--     re-select returns the single winning spot.
--   - No table changes, no RLS/policy changes, no grant changes to existing
--     objects, no data changes, no allocator reset, no renumbering, no
--     reclaim. Existing spots and claims are returned as-is, never touched.
--   - The guard trigger (trg_guard_profile_security_fields) permits exactly
--     the NULL -> set-with-claim transition this function performs; the
--     claim row is ensured by the nested allocator call first.
--
-- CALLERS: POST /api/onboarding/photos (after the photo row commits) and any
-- idempotent re-entry while profiles.spot IS NULL. Safe to retry: existing
-- spot short-circuits before any allocator call, so duplicates and counter
-- increments are impossible on retry.

create or replace function public.finalize_onboarding_completion()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_profile_id uuid;
  v_username text;
  v_spot int;
  v_photo_count int;
begin
  if v_user is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select p.id, p.username, p.spot into v_profile_id, v_username, v_spot
    from public.profiles p where p.user_id = v_user;
  if v_profile_id is null then
    raise exception 'profile required';
  end if;

  -- Existing holders converge without touching the allocator: never a second
  -- spot, never a counter increment, never a rewrite of the stored value.
  if v_spot is not null then
    return jsonb_build_object('spot', v_spot, 'already_allocated', true);
  end if;

  -- Completion preconditions: the onboarding identity (username) was
  -- established at profile creation, and at least one durable photo row
  -- exists for the caller's own profile.
  if v_username is null or btrim(v_username) = '' then
    raise exception 'username required';
  end if;
  select count(*)::int into v_photo_count
    from public.profile_photos ph where ph.profile_id = v_profile_id;
  if v_photo_count is null or v_photo_count < 1 then
    raise exception 'photo required';
  end if;

  -- Allocate-or-reuse via the existing atomic allocator (row-locked bump +
  -- per-user claim with ON CONFLICT DO NOTHING + re-select). Returns the
  -- existing claim for retries; concurrent first-time callers collapse to
  -- one number (the loser's claim insert is a no-op).
  select public.allocate_campus_spot() into v_spot;
  if v_spot is null then
    raise exception 'allocator unavailable';
  end if;

  -- NULL -> allocated only, caller-owned row only. Satisfies the guard
  -- trigger's claim-match rule by construction (claim ensured above).
  update public.profiles set spot = v_spot
   where user_id = v_user and spot is null;

  -- Re-read so a concurrent finalize loser (zero rows updated) still returns
  -- the single committed spot instead of a stale local.
  select p.spot into v_spot from public.profiles p where p.user_id = v_user;
  if v_spot is null then
    raise exception 'allocator unavailable';
  end if;
  return jsonb_build_object('spot', v_spot, 'already_allocated', false);
end; $$;

revoke all on function public.finalize_onboarding_completion() from public, anon;
grant execute on function public.finalize_onboarding_completion() to authenticated;

comment on function public.finalize_onboarding_completion() is
  'Server-owned onboarding completion: after an owned profile + >=1 durable photo exist, allocate-or-reuse the permanent campus spot via allocate_campus_spot() and persist it (NULL -> spot only). Idempotent per user; refuses admins and anonymous callers; authenticated only.';
