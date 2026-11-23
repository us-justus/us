-- Route-gated admin RPCs are service_role-only. Service-role JWTs do not carry
-- the signed-in admin's auth.uid(), so each public entry point receives the
-- server-verified actor and establishes that context only after membership is
-- checked. Existing bodies are retained under unreachable internal names.

create or replace function public.inside_admin_actor_ok(p_actor_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select p_actor_id is not null
     and exists (select 1 from public.admin_users where user_id = p_actor_id);
$$;
revoke all on function public.inside_admin_actor_ok(uuid) from public, anon, authenticated;

alter function public.admin_overview_counts() rename to inside_admin_overview_counts_body;
alter function public.admin_list_students(text, integer, integer, text) rename to inside_admin_list_students_body;
alter function public.admin_list_reports(text, integer, integer) rename to inside_admin_list_reports_body;
alter function public.admin_list_feedback(text, integer, integer) rename to inside_admin_list_feedback_body;
alter function public.admin_waitlist_email_queue_summary() rename to inside_admin_email_queue_summary_body;
alter function public.admin_prepare_waitlist_email_queue() rename to inside_admin_prepare_email_queue_body;
alter function public.admin_set_student_active(uuid, boolean, text) rename to inside_admin_set_student_active_body;
alter function public.admin_resolve_report(uuid, text) rename to inside_admin_resolve_report_body;
alter function public.admin_resolve_feedback(uuid) rename to inside_admin_resolve_feedback_body;

revoke all on function public.inside_admin_overview_counts_body() from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_list_students_body(text, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_list_reports_body(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_list_feedback_body(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_email_queue_summary_body() from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_prepare_email_queue_body() from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_set_student_active_body(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_resolve_report_body(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.inside_admin_resolve_feedback_body(uuid) from public, anon, authenticated, service_role;

create or replace function public.admin_overview_counts(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_waiting integer;
  v_suspended integer;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_waiting := public.get_waitlist_count();

  select count(*)::integer into v_suspended
    from public.profiles p
   where p.is_active = false;

  return jsonb_build_object('waiting', v_waiting, 'suspended', v_suspended);
end;
$$;

create or replace function public.admin_list_students(
  p_actor_id uuid,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_status text default 'all'
)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('all', 'active', 'suspended') then
    raise exception 'invalid student status filter' using errcode = '22000';
  end if;
  with base as (
    select coalesce(v.user_id, p.user_id) as user_id, v.usn, v.email,
      v.email_verified, v.verification_status, v.created_at as verification_created_at,
      p.username, p.spot, p.nickname, p.age, p.year, p.branch, p.is_active,
      p.suspension_reason, p.suspended_at, p.created_at as profile_created_at,
      p.updated_at as profile_updated_at,
      (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photo_count
    from public.verification_records v
    full outer join public.profiles p on p.user_id = v.user_id
  ), filtered as (
    select * from base where (v_search is null or username ilike '%' || v_search || '%'
      or nickname ilike '%' || v_search || '%' or usn ilike '%' || v_search || '%'
      or email ilike '%' || v_search || '%'
      or (v_search ~ '^[0-9]+$' and spot = v_search::int))
      and (p_status = 'all' or (p_status = 'active' and is_active is distinct from false)
      or (p_status = 'suspended' and is_active = false))
  ), total as (select count(*) as n from filtered)
  select jsonb_build_object('students', coalesce((select jsonb_agg(r order by r.sort_key desc nulls last)
    from (select user_id, usn, email, email_verified, verification_status, verification_created_at,
      username, spot, nickname, age, year, branch, is_active, suspension_reason, suspended_at,
      profile_created_at, profile_updated_at, photo_count,
      coalesce(profile_created_at, verification_created_at) as sort_key
      from filtered order by coalesce(profile_created_at, verification_created_at) desc nulls last
      limit v_limit offset v_offset) r), '[]'::jsonb), 'total', (select n from total)) into v_result;
  return v_result;
end; $$;

create or replace function public.admin_list_reports(
  p_actor_id uuid,
  p_status text default 'unresolved',
  p_limit integer default 20,
  p_offset integer default 0
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
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
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

create or replace function public.admin_list_feedback(
  p_actor_id uuid,
  p_status text default 'open',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_result jsonb;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status not in ('open', 'resolved', 'all') then
    raise exception 'invalid feedback status filter' using errcode = '22000';
  end if;
  with base as (
    select f.id, f.user_id, f.category, f.message, f.status, f.created_at,
      f.admin_reply, f.replied_at, f.resolved_at, f.suspension_related,
      f.related_suspension_at, p.username, p.nickname, v.usn, v.email,
      (p.is_active = false) as author_suspended, p.suspension_reason as author_suspension_reason
    from public.feedback f left join public.profiles p on p.user_id = f.user_id
      left join public.verification_records v on v.user_id = f.user_id
    where v_status = 'all' or (v_status = 'open' and f.status = 'OPEN')
      or (v_status = 'resolved' and f.status = 'RESOLVED')
  ), total as (select count(*) as n from base)
  select jsonb_build_object('feedback', coalesce((select jsonb_agg(r order by (r.status = 'OPEN') desc, r.created_at desc)
    from (select * from base order by (status = 'OPEN') desc, created_at desc limit v_limit offset v_offset) r), '[]'::jsonb),
    'total', (select n from total)) into v_result;
  return v_result;
end; $$;

create or replace function public.admin_waitlist_email_queue_summary(p_actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with audience as materialized (
    select * from public.waitlist_email_eligible_students()
  ),
  audience_counts as (
    select count(*)::integer as waiting_student_count,
           count(distinct email)::integer as unique_recipient_count
    from audience
  ),
  queue_counts as (
    select
      count(*) filter (where q.status = 'PENDING')::integer as pending,
      count(*) filter (where q.status = 'SENDING')::integer as sending,
      count(*) filter (where q.status = 'SENT')::integer as sent,
      count(*) filter (where q.status = 'FAILED')::integer as failed,
      count(*) filter (where q.status = 'SKIPPED')::integer as skipped_queue
    from public.waitlist_email_queue q
  ),
  last_prepared as (
    select max(e.created_at) as last_prepared_at
    from public.inside_audit_events e
    where e.action = 'WAITLIST_EMAIL_QUEUE_PREPARED'
  )
  select jsonb_build_object(
    'waitingStudentCount', c.waiting_student_count,
    'uniqueRecipientCount', c.unique_recipient_count,
    'skippedCount',
      (select count(*)::integer from public.profiles) - c.waiting_student_count,
    'students',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'username', a.username,
              'nickname', a.nickname,
              'usn', a.usn,
              'spot', a.spot,
              'email', a.email
            )
            order by a.spot nulls last, a.username nulls last, a.usn nulls last
          )
          from audience a
        ),
        '[]'::jsonb
      ),
    'pending', q.pending,
    'sending', q.sending,
    'sent', q.sent,
    'failed', q.failed,
    'skippedQueue', q.skipped_queue,
    'lastPreparedAt', lp.last_prepared_at
  )
  into v_result
  from audience_counts c
  cross join queue_counts q
  cross join last_prepared lp;

  return v_result;
end;
$$;

create or replace function public.admin_prepare_waitlist_email_queue(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_waiting_student_count integer;
  v_unique_recipient_count integer;
  v_added_count integer;
  v_already_prepared_count integer;
  v_skipped_count integer;
  v_students jsonb;
  v_recipients jsonb;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with audience as materialized (select * from public.waitlist_email_eligible_students()),
  unique_recipients as materialized (
    select distinct on (a.email) a.user_id, a.email
    from audience a order by a.email, a.user_id
  ),
  inserted as (
    insert into public.waitlist_email_queue (user_id, email)
    select r.user_id, r.email from unique_recipients r
    on conflict (email) do nothing returning email
  )
  select
    (select count(*)::integer from audience),
    (select count(*)::integer from unique_recipients),
    (select count(*)::integer from inserted),
    (select count(*)::integer from public.profiles) - (select count(*)::integer from audience),
    coalesce((select jsonb_agg(jsonb_build_object(
      'username', a.username, 'nickname', a.nickname, 'usn', a.usn,
      'spot', a.spot, 'email', a.email
    ) order by a.spot nulls last, a.username nulls last, a.usn nulls last) from audience a), '[]'::jsonb),
    coalesce((select jsonb_agg(r.email order by r.email) from unique_recipients r), '[]'::jsonb)
  into v_waiting_student_count, v_unique_recipient_count, v_added_count,
       v_skipped_count, v_students, v_recipients;

  v_already_prepared_count := v_unique_recipient_count - v_added_count;

  select coalesce(jsonb_agg(q.email order by q.email), '[]'::jsonb)
    into v_recipients
    from public.waitlist_email_queue q
   where q.email in (
     select recipient.email
     from jsonb_array_elements_text(v_recipients) as recipient(email)
   );

  insert into public.inside_audit_events (actor_user_id, action, target_type, metadata)
  values (
    p_actor_id,
    'WAITLIST_EMAIL_QUEUE_PREPARED',
    'waitlist_email_queue',
    jsonb_build_object(
      'waiting_student_count', v_waiting_student_count,
      'unique_recipient_count', v_unique_recipient_count,
      'added_count', v_added_count,
      'already_prepared_count', v_already_prepared_count,
      'skipped_count', v_skipped_count
    )
  );

  return jsonb_build_object(
    'waitingStudentCount', v_waiting_student_count,
    'uniqueRecipientCount', v_unique_recipient_count,
    'addedCount', v_added_count,
    'alreadyPreparedCount', v_already_prepared_count,
    'skippedCount', v_skipped_count,
    'students', v_students,
    'recipients', v_recipients
  );
end;
$$;

create or replace function public.admin_set_student_active(
  p_actor_id uuid, p_target_user_id uuid, p_active boolean, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_prev boolean; v_next boolean; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_target_user_id is null or p_active is null then raise exception 'target and active state are required' using errcode = '22000'; end if;
  if v_reason is not null and char_length(v_reason) > 280 then raise exception 'suspension reason too long' using errcode = '22000'; end if;
  if p_active = false then
    if v_reason is null then raise exception 'suspension reason is required' using errcode = '22000'; end if;
    update public.profiles set is_active = false, suspension_reason = v_reason, suspended_at = now(),
      suspended_by = p_actor_id, updated_at = now() where user_id = p_target_user_id and is_active is distinct from false;
  else
    update public.profiles set is_active = true, suspension_reason = null, suspended_at = null,
      suspended_by = null, updated_at = now() where user_id = p_target_user_id and is_active is distinct from true;
  end if;
  if not found then
    select is_active into v_prev from public.profiles where user_id = p_target_user_id;
    if not found then raise exception 'student not found' using errcode = '02000'; end if;
    return jsonb_build_object('user_id', p_target_user_id, 'previous_active', v_prev, 'new_active', v_prev, 'changed', false);
  end if;
  v_prev := not p_active; v_next := p_active;
  return jsonb_build_object('user_id', p_target_user_id, 'previous_active', v_prev, 'new_active', v_next, 'changed', true);
end; $$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_resolution text, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev text;
  v_reported uuid;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_report_id is null then raise exception 'report id is required' using errcode = '22000'; end if;
  if p_resolution not in ('resolved', 'dismissed') then
    raise exception 'resolution must be resolved or dismissed' using errcode = '22000';
  end if;
  select status, reported_id into v_prev, v_reported from public.reports where id = p_report_id;
  if not found then raise exception 'report not found' using errcode = '02000'; end if;
  if v_prev = p_resolution then
    return jsonb_build_object('id', p_report_id, 'reported_id', v_reported,
      'previous_status', v_prev, 'new_status', v_prev, 'changed', false);
  end if;
  update public.reports set status = p_resolution where id = p_report_id;
  return jsonb_build_object('id', p_report_id, 'reported_id', v_reported,
    'previous_status', v_prev, 'new_status', p_resolution, 'changed', true);
end;
$$;

create or replace function public.admin_resolve_feedback(p_feedback_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev text;
begin
  if p_actor_id is null or not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_feedback_id is null then raise exception 'feedback id is required' using errcode = '22000'; end if;
  select status into v_prev from public.feedback where id = p_feedback_id;
  if not found then raise exception 'feedback not found' using errcode = '02000'; end if;
  if v_prev = 'RESOLVED' then
    return jsonb_build_object('id', p_feedback_id, 'previous_status', v_prev,
      'new_status', v_prev, 'changed', false);
  end if;
  update public.feedback set status = 'RESOLVED', resolved_at = now(), resolved_by = p_actor_id
    where id = p_feedback_id;
  return jsonb_build_object('id', p_feedback_id, 'previous_status', v_prev,
    'new_status', 'RESOLVED', 'changed', true);
end;
$$;

revoke all on function public.admin_overview_counts(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_students(uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.admin_list_reports(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_feedback(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_waitlist_email_queue_summary(uuid) from public, anon, authenticated;
revoke all on function public.admin_prepare_waitlist_email_queue(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_student_active(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_resolve_feedback(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_overview_counts(uuid) to service_role;
grant execute on function public.admin_list_students(uuid, text, integer, integer, text) to service_role;
grant execute on function public.admin_list_reports(uuid, text, integer, integer) to service_role;
grant execute on function public.admin_list_feedback(uuid, text, integer, integer) to service_role;
grant execute on function public.admin_waitlist_email_queue_summary(uuid) to service_role;
grant execute on function public.admin_prepare_waitlist_email_queue(uuid) to service_role;
grant execute on function public.admin_set_student_active(uuid, uuid, boolean, text) to service_role;
grant execute on function public.admin_resolve_report(uuid, text, uuid) to service_role;
grant execute on function public.admin_resolve_feedback(uuid, uuid) to service_role;
