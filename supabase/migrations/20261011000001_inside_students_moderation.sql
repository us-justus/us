-- us INSIDE Step 3: students + moderation (staging only).
--
-- REUSES (nothing existing is modified or weakened):
--   - profiles.is_active (default true) as the account-status mechanism.
--     Discover, search, /u/[username], and invites already exclude
--     is_active = false rows, so suspend = is_active false, restore = true.
--     No new status column, no unrelated field overloaded.
--   - public.reports.status (pending/reviewed/resolved/dismissed) for the
--     moderation queue. No duplicate reports table.
--   - public.inside_audit_events + src/lib/inside/audit.ts for attribution.
--   - requireInsideAdmin() + is_admin() for authorization (defense in depth:
--     routes check the gate AND every function below re-checks is_admin()).
--
-- ADDS:
--   1. Three audit actions on the CHECK constraint: STUDENT_SUSPENDED,
--      STUDENT_RESTORED, REPORT_RESOLVED. The six Step 2 actions are kept.
--   2. admin_list_students() — SECURITY DEFINER paginated student listing
--      with search over username / nickname / USN. Returns admin-useful
--      fields only (user_id, USN, email, profile display fields,
--      verification + onboarding state, timestamps, is_active). Never
--      touches auth.users: no passwords, tokens, or auth internals can leak.
--   3. admin_set_student_active() — SECURITY DEFINER suspend/restore writer.
--      Returns previous + new state so the route skips audit on no-ops.
--   4. admin_list_reports() — SECURITY DEFINER paginated report queue with
--      reporter/reported public identity context. Defaults to unresolved
--      (pending + reviewed).
--   5. admin_resolve_report() — SECURITY DEFINER report resolver
--      (resolved / dismissed only). Returns previous + new state plus a
--      changed flag so no-ops record no audit event.
--
-- SECURITY MODEL (mirrors admin_overview_counts / admin_set_launch):
--   - All functions refuse unless is_admin(). Direct invocation by a
--     student session raises 42501 and changes nothing.
--   - EXECUTE granted to authenticated only (the admin session client);
--     revoked from public/anon. No service-role grant, no RLS weakening.
--
-- ROLLBACK: drop the four functions below, then restore the six-action
-- CHECK (see the down-migration comment at the end).

-- ============================================================
-- PART 1 — extend the audit CHECK constraint (drop + re-add:
-- Postgres cannot ALTER a CHECK list in place)
-- ============================================================
alter table public.inside_audit_events
  drop constraint if exists inside_audit_events_action_check;

alter table public.inside_audit_events
  add constraint inside_audit_events_action_check check (action in (
    'ADMIN_LOGIN_SUCCESS',
    'ADMIN_LOGIN_FAILURE',
    'ADMIN_LOGOUT',
    'LAUNCH_ENABLED',
    'LAUNCH_DISABLED',
    'LAUNCH_VERSION_CHANGED',
    'STUDENT_SUSPENDED',
    'STUDENT_RESTORED',
    'REPORT_RESOLVED'
  ));

-- ============================================================
-- PART 2 — admin_list_students()
-- ============================================================
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
  v_total int;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Full outer join: verification-first rows (USN step done, no profile
  -- yet) and profile-first rows both appear. auth.users is never read.
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
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(t order by t.sort_key desc nulls last), '[]'::jsonb)
    into v_rows
  from (
    select
      user_id, usn, email, email_verified, verification_status,
      verification_created_at, username, spot, nickname, age, year, branch,
      is_active, profile_created_at, profile_updated_at, photo_count,
      coalesce(profile_created_at, verification_created_at) as sort_key
    from filtered
    order by coalesce(profile_created_at, verification_created_at) desc nulls last
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('students', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_list_students(text, int, int) from public;
grant execute on function public.admin_list_students(text, int, int) to authenticated;

comment on function public.admin_list_students(text, int, int) is
  'INSIDE Step 3: paginated admin student listing (username/nickname/USN search). Admin-only; public fields only, never auth-schema internals.';

-- ============================================================
-- PART 3 — admin_set_student_active()
-- ============================================================
create or replace function public.admin_set_student_active(
  p_target_user_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev boolean;
  v_next boolean;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_target_user_id is null or p_active is null then
    raise exception 'target and active state are required' using errcode = '22000';
  end if;

  update public.profiles
     set is_active = p_active,
         updated_at = now()
   where user_id = p_target_user_id
     and is_active is distinct from p_active;

  if not found then
    -- Either no profile row, or already in the target state. Distinguish
    -- so the route can skip audit on no-ops without a second read.
    select is_active into v_prev
      from public.profiles
     where user_id = p_target_user_id;
    if not found then
      raise exception 'student not found' using errcode = '02000';
    end if;
    return jsonb_build_object(
      'user_id', p_target_user_id,
      'previous_active', v_prev,
      'new_active', v_prev,
      'changed', false
    );
  end if;

  v_prev := not p_active;
  v_next := p_active;

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'previous_active', v_prev,
    'new_active', v_next,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_set_student_active(uuid, boolean) from public;
grant execute on function public.admin_set_student_active(uuid, boolean) to authenticated;

comment on function public.admin_set_student_active(uuid, boolean) is
  'INSIDE Step 3: suspend (false) / restore (true) a student via profiles.is_active. Admin-only; reports previous/new state plus a changed flag so routes skip audit on no-ops.';

-- ============================================================
-- PART 4 — admin_list_reports()
-- ============================================================
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
  v_total int;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status not in ('unresolved', 'pending', 'reviewed', 'resolved', 'dismissed', 'all') then
    raise exception 'invalid report status filter' using errcode = '22000';
  end if;

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
  )
  select count(*) into v_total from base;

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select * from base
    order by created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('reports', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_list_reports(text, int, int) from public;
grant execute on function public.admin_list_reports(text, int, int) to authenticated;

comment on function public.admin_list_reports(text, int, int) is
  'INSIDE Step 3: paginated admin report queue (defaults to unresolved). Admin-only; reporter/reported context is public profile fields only.';

-- ============================================================
-- PART 5 — admin_resolve_report()
-- ============================================================
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev text;
  v_reported uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_report_id is null then
    raise exception 'report id is required' using errcode = '22000';
  end if;

  if p_resolution not in ('resolved', 'dismissed') then
    raise exception 'resolution must be resolved or dismissed' using errcode = '22000';
  end if;

  select status, reported_id into v_prev, v_reported
    from public.reports
   where id = p_report_id;

  if not found then
    raise exception 'report not found' using errcode = '02000';
  end if;

  if v_prev = p_resolution then
    -- No-op: already in the target state. The route records no audit event.
    return jsonb_build_object(
      'id', p_report_id,
      'reported_id', v_reported,
      'previous_status', v_prev,
      'new_status', v_prev,
      'changed', false
    );
  end if;

  update public.reports
     set status = p_resolution
   where id = p_report_id;

  return jsonb_build_object(
    'id', p_report_id,
    'reported_id', v_reported,
    'previous_status', v_prev,
    'new_status', p_resolution,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_resolve_report(uuid, text) from public;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;

comment on function public.admin_resolve_report(uuid, text) is
  'INSIDE Step 3: resolve (resolved/dismissed) a report. Admin-only; no-op when already in the target state so routes can skip audit.';

-- ROLLBACK (down-migration sketch, not executed here):
--   drop function public.admin_resolve_report(uuid, text);
--   drop function public.admin_list_reports(text, int, int);
--   drop function public.admin_set_student_active(uuid, boolean);
--   drop function public.admin_list_students(text, int, int);
--   alter table public.inside_audit_events drop constraint inside_audit_events_action_check;
--   alter table public.inside_audit_events add constraint inside_audit_events_action_check
--     check (action in ('ADMIN_LOGIN_SUCCESS','ADMIN_LOGIN_FAILURE','ADMIN_LOGOUT',
--       'LAUNCH_ENABLED','LAUNCH_DISABLED','LAUNCH_VERSION_CHANGED'));
