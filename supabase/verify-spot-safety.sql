-- READ-ONLY pre/post deploy snapshot for the spot-completion change.
--
-- NOT A MIGRATION: this file lives outside supabase/migrations/ and is never
-- applied by `supabase db push`. Run it manually (read-only role) before and
-- after deploying the completion-boundary change, then diff the two outputs.
--
-- EXPECTED: every row below is byte-identical across the deploy, except
-- campus_spot_allocator.next_spot and the waiting count, which may grow by
-- exactly the number of NEW completions finalized after the deploy.
-- Existing profiles.spots, claims, and photo counts must never change.

-- 1. Existing spot holders (identity + permanence proof).
select p.user_id, p.username, p.spot,
       (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photo_count,
       (select c.spot from public.campus_spot_claims c where c.user_id = p.user_id) as claim_spot
  from public.profiles p
 where p.spot is not null
 order by p.spot;

-- 2. Profiles still awaiting completion (NULL spot is legal by design).
select p.user_id, p.username, p.spot,
       (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photo_count
  from public.profiles p
 where p.spot is null
 order by p.username nulls last;

-- 3. Claim rows (idempotency record; one row per finalized user, never rewritten).
select c.user_id, c.spot, c.created_at
  from public.campus_spot_claims c
 order by c.spot;

-- 4. Allocator counter (monotonic; never reset to 1, never decremented).
select id, next_spot from public.campus_spot_allocator where id = 1;

-- 5. Waiting population (active + >=1 photo; must not reference spot).
select public.get_waitlist_count() as waiting;

-- 6. Orphan-claim check: claims with no matching profile spot (pre-existing
-- crash-window rows are grandfathered; this number must not GROW for users
-- who completed before the deploy).
select count(*) as orphan_claims
  from public.campus_spot_claims c
  left join public.profiles p on p.user_id = c.user_id and p.spot = c.spot
 where p.user_id is null;
