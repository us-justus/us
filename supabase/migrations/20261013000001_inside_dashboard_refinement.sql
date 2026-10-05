-- us INSIDE dashboard refinement: operational overview + student directory.
--
-- CONTEXT: /inside is a permanent admin/operations dashboard (the launch
-- system was removed in 20261012000001). The Step 1 overview exposed
-- { total_users, waiting } where total_users = count(*) of
-- verification_records (every USN-touched account — broader than the
-- waitlist and easy for an admin to misread) and waiting = profiles with
-- >= 1 photo (which silently INCLUDED suspended students). This migration
-- replaces both with the two numbers the admin actually operates on.
--
-- WAITING (authoritative dashboard definition): an active profile
-- (profiles.is_active IS DISTINCT FROM false) with >= 1 row in
-- profile_photos — the profile/photo-complete tail of getOnboardingState()
-- (src/lib/onboarding/state.ts: profile exists + photo count >= 1 =
-- step "complete"). The email-verified head of that gate lives in
-- auth.users, which admin RPCs never read by design (see SECURITY below),
-- so the overview counts the photo-complete ACTIVE population — exactly the
-- students the admin considers part of the waitlist. Suspended students are
-- excluded here and counted separately.
--
-- SUSPENDED: count(*) of profiles where is_active = false. Reuses the
-- existing moderation state; no new status column.
--
-- total_users is DROPPED from the contract (not from any table): a bare
-- verification_records count is broader than the waiting population and has
-- no operational meaning on this dashboard.
--
-- STUDENT DIRECTORY: admin_list_students() gains
--   1. email search (verification_records.email ilike, alongside the
--      existing username / nickname / USN / spot search), and
--   2. p_status ('all' | 'active' | 'suspended', default 'all') reusing
--      profiles.is_active — no new column, no new table.
-- The single-statement CTE pattern from the 42P01 fix (20261011000002) is
-- preserved: total + page resolve in ONE statement.
--
-- email_skipped: left untouched. The legacy column stays parsable for
-- historical rows; no UI or filter is built on it (email is required).
--
-- SECURITY MODEL (unchanged): both functions refuse unless is_admin().
-- EXECUTE to authenticated only (revoked from public + anon). auth.users is
-- never read: no passwords, tokens, or auth internals can leak. No RLS
-- change, no policy change, no service-role grant.
--
-- ROLLBACK: restore admin_overview_counts() from 20261002000004 and
-- admin_list_students(text, int, int) from 20261011000002.

-- ============================================================
-- PART 1 — admin_overview_counts() -> { waiting, suspended }
-- ============================================================
create or replace function public.admin_overview_counts()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_waiting int;
  v_suspended int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Active waitlist: photo-complete profiles that are not suspended.
  select count(*) into v_waiting
    from public.profiles p
   where p.is_active is distinct from false
     and exists (
       select 1 from public.profile_photos ph where ph.profile_id = p.id
     );

  select count(*) into v_suspended
    from public.profiles p
   where p.is_active = false;

  return jsonb_build_object('waiting', v_waiting, 'suspended', v_suspended);
end;
$$;

revoke all on function public.admin_overview_counts() from public;
revoke all on function public.admin_overview_counts() from anon;
grant execute on function public.admin_overview_counts() to authenticated;

comment on function public.admin_overview_counts() is
  'INSIDE dashboard: { waiting, suspended } aggregates. waiting = active photo-complete profiles (the waitlist); suspended = profiles with is_active = false. Admin-only; exposes no private fields.';

-- ============================================================
-- PART 2 — admin_list_students() + email search + status filter
-- (signature gains p_status with a default, so existing 3-arg callers
-- keep working; DROP + CREATE because OR REPLACE cannot change arity)
-- ============================================================
drop function if exists public.admin_list_students(text, int, int);

create function public.admin_list_students(
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_status text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status not in ('all', 'active', 'suspended') then
    raise exception 'invalid student status filter' using errcode = '22000';
  end if;

  -- Single statement: every CTE below is visible to the whole query.
  -- Full outer join: verification-first rows (USN step done, no profile
  -- yet) and profile-first rows both appear. The auth schema is never read.
  with base as (
    select
      coalesce(v.user_id, p.user_id) as user_id,
      v.usn as usn,
      v.email as email,
      v.email_verified as email_verified,
      v.verification_status as verification_status,
      v.created_at as verification_created_at,
      p.username as username,
      p.spot as spot,
      p.nickname as nickname,
      p.age as age,
      p.year as year,
      p.branch as branch,
      p.is_active as is_active,
      p.created_at as profile_created_at,
      p.updated_at as profile_updated_at,
      (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photo_count
    from public.verification_records v
    full outer join public.profiles p on p.user_id = v.user_id
  ),
  filtered as (
    select * from base
    where (
      v_search is null
       or username ilike '%' || v_search || '%'
       or nickname ilike '%' || v_search || '%'
       or usn ilike '%' || v_search || '%'
       or email ilike '%' || v_search || '%'
       or (v_search ~ '^[0-9]+$' and spot = v_search::int)
    )
    and (
      p_status = 'all'
       or (p_status = 'active' and is_active is distinct from false)
       or (p_status = 'suspended' and is_active = false)
    )
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'students',
    coalesce(
      (
        select jsonb_agg(r order by r.sort_key desc nulls last)
        from (
          select
            user_id, usn, email, email_verified, verification_status,
            verification_created_at, username, spot, nickname, age, year, branch,
            is_active, profile_created_at, profile_updated_at, photo_count,
            coalesce(profile_created_at, verification_created_at) as sort_key
          from filtered
          order by coalesce(profile_created_at, verification_created_at) desc nulls last
          limit v_limit offset v_offset
        ) r
      ),
      '[]'::jsonb
    ),
    'total',
    (select n from total)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_list_students(text, int, int, text) from public;
revoke all on function public.admin_list_students(text, int, int, text) from anon;
grant execute on function public.admin_list_students(text, int, int, text) to authenticated;

comment on function public.admin_list_students(text, int, int, text) is
  'INSIDE dashboard: paginated admin student listing (username/nickname/USN/email/spot search, all/active/suspended filter). Admin-only; public fields only, never auth-schema internals.';
