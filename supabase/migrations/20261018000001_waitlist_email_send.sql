-- Step 5: explicit waitlist email send states.
--
-- PREPARE stays untouched: it snapshots unique normalized emails as PENDING
-- rows and never sends. This migration only widens the durable lifecycle
-- so a separate explicit send operation can claim rows race-safely,
-- deliver through Brevo in application code, and record skipped recipients
-- without rewriting snapshots:
--
--   PENDING -> SENDING (atomic per-row claim before any provider call)
--   SENDING -> SENT    (Brevo accepted; provider id + sent_at recorded)
--   SENDING -> FAILED  (Brevo 4xx/5xx, network failure, or timeout)
--   SENDING -> SKIPPED (re-checked eligibility failed or snapshot email
--                       no longer matches the current verified email)
--
-- SENDING rows whose updated_at is stale are reclaimable by a later explicit
-- send (crash recovery); SENT rows are never sent again. Temporary FAILED
-- rows (last_error like 'temporary:%' with next_attempt_at due) may be
-- retried by a later explicit send; permanent FAILED and SKIPPED rows are
-- terminal. No provider calls, no background worker, no generic campaign
-- machinery, and no audience-semantics change happen here.

alter table public.waitlist_email_queue
  drop constraint if exists waitlist_email_queue_status_check;

alter table public.waitlist_email_queue
  add constraint waitlist_email_queue_status_check check (status in (
    'PENDING',
    'SENDING',
    'SENT',
    'FAILED',
    'SKIPPED'
  ));

-- Keep the Step 4 audience authoritative: the summary still resolves
-- waitlist_email_eligible_students() exactly once and keeps every existing
-- field. It additionally exposes the durable send states so the admin UI
-- can show them without a second query.
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

revoke all on function public.admin_waitlist_email_queue_summary() from public;
revoke all on function public.admin_waitlist_email_queue_summary() from anon;
grant execute on function public.admin_waitlist_email_queue_summary() to authenticated;

comment on function public.admin_waitlist_email_queue_summary() is
  'INSIDE Step 5: authoritative eligible student list plus durable queue metrics including sending/skipped send states. Admin-only.';

-- Add the send action to the active audit CHECK while retaining every
-- permanent action. Send audits carry aggregate counts only.
alter table public.inside_audit_events
  drop constraint if exists inside_audit_events_action_check;

alter table public.inside_audit_events
  add constraint inside_audit_events_action_check check (action in (
    'ADMIN_LOGIN_SUCCESS',
    'ADMIN_LOGIN_FAILURE',
    'ADMIN_LOGOUT',
    'STUDENT_SUSPENDED',
    'STUDENT_RESTORED',
    'REPORT_RESOLVED',
    'FEEDBACK_REPLIED',
    'FEEDBACK_RESOLVED',
    'WAITLIST_EMAIL_QUEUE_PREPARED',
    'WAITLIST_EMAIL_SENT'
  ));
