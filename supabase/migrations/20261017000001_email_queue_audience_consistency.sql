-- Keep the Step 4 email audience at the student/profile level. Recipient
-- deduplication happens separately, by normalized email, when preparing the
-- durable queue snapshot.

create or replace function public.waitlist_email_eligible_students()
returns table (
  user_id uuid,
  username text,
  nickname text,
  usn text,
  spot integer,
  email text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    p.user_id,
    p.username,
    p.nickname,
    v.usn,
    p.spot,
    lower(btrim(v.email)) as email
  from public.profiles p
  join public.verification_records v on v.user_id = p.user_id
  where p.is_active is distinct from false
    and exists (
      select 1
      from public.profile_photos ph
      where ph.profile_id = p.id
    )
    and v.email is not null
    and btrim(v.email) <> ''
    and char_length(btrim(v.email)) <= 254
    and lower(btrim(v.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(btrim(v.email)) not like 'u-%@us.signin.invalid'
$$;

revoke all on function public.waitlist_email_eligible_students() from public;
revoke all on function public.waitlist_email_eligible_students() from anon;
revoke all on function public.waitlist_email_eligible_students() from authenticated;

comment on function public.waitlist_email_eligible_students() is
  'Private Step 4 audience: one row per eligible active, photo-complete profile with a valid external verification email. Shared emails remain separate students.';

create or replace function public.admin_waitlist_email_queue_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
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
      count(*) filter (where q.status = 'SENT')::integer as sent,
      count(*) filter (where q.status = 'FAILED')::integer as failed
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
    'sent', q.sent,
    'failed', q.failed,
    'lastPreparedAt', lp.last_prepared_at
  )
  into v_result
  from audience_counts c
  cross join queue_counts q
  cross join last_prepared lp;

  return v_result;
end;
$$;

revoke all on function public.admin_waitlist_email_queue_summary() from public;
revoke all on function public.admin_waitlist_email_queue_summary() from anon;
grant execute on function public.admin_waitlist_email_queue_summary() to authenticated;

comment on function public.admin_waitlist_email_queue_summary() is
  'INSIDE Step 4: returns the authoritative eligible student list and its student/recipient counts, plus secondary queue metrics. Admin-only.';

create or replace function public.admin_prepare_waitlist_email_queue()
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
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with audience as materialized (
    select * from public.waitlist_email_eligible_students()
  ),
  unique_recipients as materialized (
    select distinct on (a.email)
      a.user_id,
      a.email
    from audience a
    order by a.email, a.user_id
  ),
  inserted as (
    insert into public.waitlist_email_queue (user_id, email)
    select r.user_id, r.email
    from unique_recipients r
    on conflict (email) do nothing
    returning email
  )
  select
    (select count(*)::integer from audience),
    (select count(*)::integer from unique_recipients),
    (select count(*)::integer from inserted),
    (select count(*)::integer from public.profiles)
      - (select count(*)::integer from audience),
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
    coalesce(
      (
        select jsonb_agg(r.email order by r.email)
        from unique_recipients r
      ),
      '[]'::jsonb
    )
  into
    v_waiting_student_count,
    v_unique_recipient_count,
    v_added_count,
    v_skipped_count,
    v_students,
    v_recipients;

  v_already_prepared_count := v_unique_recipient_count - v_added_count;

  -- Return the persisted normalized snapshots, not a client-rebuilt list.
  select coalesce(jsonb_agg(q.email order by q.email), '[]'::jsonb)
    into v_recipients
    from public.waitlist_email_queue q
   where q.email in (
     select recipient.email
     from jsonb_array_elements_text(v_recipients) as recipient(email)
   );

  insert into public.inside_audit_events (
    actor_user_id,
    action,
    target_type,
    metadata
  )
  values (
    auth.uid(),
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

revoke all on function public.admin_prepare_waitlist_email_queue() from public;
revoke all on function public.admin_prepare_waitlist_email_queue() from anon;
grant execute on function public.admin_prepare_waitlist_email_queue() to authenticated;

comment on function public.admin_prepare_waitlist_email_queue() is
  'INSIDE Step 4: snapshots unique normalized emails for the current authoritative eligible student audience, returns the persisted recipient list and aggregate counts, and audits counts only. Does not send email.';

drop function if exists public.waitlist_email_eligible_recipients();
