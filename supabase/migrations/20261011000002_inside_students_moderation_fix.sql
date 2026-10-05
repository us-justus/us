-- us INSIDE Step 3 fix: single-statement CTE scope in the list RPCs.
--
-- BUG (caught by staging verification): admin_list_students() and
-- admin_list_reports() defined their base/filtered CTEs in one statement
-- (the COUNT) and referenced them again in a second statement (the page
-- SELECT). CTEs live for exactly one statement, so both functions raised
-- 42P01 relation "filtered"/"base" does not exist and the list routes
-- returned 500. Mutations were unaffected (no CTEs).
--
-- FIX: each function now computes total + page in ONE statement
-- (base -> filtered -> total, page subquery inside jsonb_agg). No
-- signature change, no grant change, no RLS change, no new fields.
-- is_admin() re-checks, EXECUTE grants, and comments are preserved.

create or replace function public.admin_list_students(
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
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
    where v_search is null
       or username ilike '%' || v_search || '%'
       or nickname ilike '%' || v_search || '%'
       or usn ilike '%' || v_search || '%'
       or (v_search ~ '^[0-9]+$' and spot = v_search::int)
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

revoke all on function public.admin_list_students(text, int, int) from public;
grant execute on function public.admin_list_students(text, int, int) to authenticated;

comment on function public.admin_list_students(text, int, int) is
  'INSIDE Step 3: paginated admin student listing (username/nickname/USN search). Admin-only; public fields only, never auth-schema internals.';

create or replace function public.admin_list_reports(
  p_status text default 'unresolved',
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status not in ('unresolved', 'pending', 'reviewed', 'resolved', 'dismissed', 'all') then
    raise exception 'invalid report status filter' using errcode = '22000';
  end if;

  -- Single statement: every CTE below is visible to the whole query.
  with base as (
    select
      r.id as id,
      r.reporter_id as reporter_id,
      r.reported_id as reported_id,
      r.reason as reason,
      r.details as details,
      r.status as status,
      r.created_at as created_at,
      rpt.username as reporter_username,
      rpt.nickname as reporter_nickname,
      rpd.username as reported_username,
      rpd.nickname as reported_nickname,
      rpd.is_active as reported_is_active
    from public.reports r
    left join public.profiles rpt on rpt.user_id = r.reporter_id
    left join public.profiles rpd on rpd.user_id = r.reported_id
    where (p_status = 'all')
       or (p_status = 'unresolved' and r.status in ('pending', 'reviewed'))
       or (r.status = p_status)
  ),
  total as (
    select count(*) as n from base
  )
  select jsonb_build_object(
    'reports',
    coalesce(
      (
        select jsonb_agg(r order by r.created_at desc)
        from (
          select * from base
          order by created_at desc
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

revoke all on function public.admin_list_reports(text, int, int) from public;
grant execute on function public.admin_list_reports(text, int, int) to authenticated;

comment on function public.admin_list_reports(text, int, int) is
  'INSIDE Step 3: paginated admin report queue (defaults to unresolved). Admin-only; reporter/reported context is public profile fields only.';
