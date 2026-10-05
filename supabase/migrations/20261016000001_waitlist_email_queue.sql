-- Waitlist email queue: durable audience snapshots only.
--
-- Eligibility follows the /inside waitlist definition (active profile +
-- at least one photo) and adds a validated external email from
-- verification_records.email. One lowercased, trimmed email address maps to
-- one queue row, even when multiple users share it; the first associated
-- user is selected deterministically by UUID ordering.
--
-- Queue rows preserve the normalized email captured at preparation time.
-- Suspension does not delete or rewrite a snapshot; any future sender must
-- re-check current eligibility before delivery. This migration adds no
-- sender and makes no provider calls.

create table if not exists public.waitlist_email_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null unique check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and email not like 'u-%@us.signin.invalid'
  ),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  last_error text null
);

drop trigger if exists trg_waitlist_email_queue_updated
  on public.waitlist_email_queue;
create trigger trg_waitlist_email_queue_updated
  before update on public.waitlist_email_queue
  for each row execute function public.handle_updated_at();

create index if not exists waitlist_email_queue_status_next_attempt_idx
  on public.waitlist_email_queue (status, next_attempt_at);

create index if not exists waitlist_email_queue_user_id_idx
  on public.waitlist_email_queue (user_id);

alter table public.waitlist_email_queue enable row level security;

-- No client policies or table privileges. Admin reads are count-only RPCs.
revoke all on table public.waitlist_email_queue from public;
revoke all on table public.waitlist_email_queue from anon;
revoke all on table public.waitlist_email_queue from authenticated;

comment on table public.waitlist_email_queue is
  'Prepared snapshots for a future product-availability email. One normalized email per row; email is not refreshed after queuing. Suspended users remain in the snapshot and must be rechecked by a future sender. No email delivery occurs here.';

-- Private query shared by the admin count and population RPCs. Execute is
-- revoked from client roles; only SECURITY DEFINER admin RPCs call it.
create or replace function public.waitlist_email_eligible_recipients()
returns table (user_id uuid, email text)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (lower(btrim(v.email)))
    p.user_id,
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
  order by lower(btrim(v.email)), p.user_id
$$;

revoke all on function public.waitlist_email_eligible_recipients() from public;
revoke all on function public.waitlist_email_eligible_recipients() from anon;
revoke all on function public.waitlist_email_eligible_recipients() from authenticated;

-- Add the preparation action to the active audit CHECK while retaining all
-- current permanent actions. No email addresses are stored in audit metadata.
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
    'WAITLIST_EMAIL_QUEUE_PREPARED'
  ));

create or replace function public.admin_waitlist_email_queue_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_eligible integer;
  v_pending integer;
  v_sent integer;
  v_failed integer;
  v_last_prepared_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_eligible
    from public.waitlist_email_eligible_recipients();

  select
    count(*) filter (where q.status = 'PENDING'),
    count(*) filter (where q.status = 'SENT'),
    count(*) filter (where q.status = 'FAILED')
  into v_pending, v_sent, v_failed
  from public.waitlist_email_queue q;

  select max(e.created_at) into v_last_prepared_at
    from public.inside_audit_events e
   where e.action = 'WAITLIST_EMAIL_QUEUE_PREPARED';

  return jsonb_build_object(
    'eligible', v_eligible,
    'pending', v_pending,
    'sent', v_sent,
    'failed', v_failed,
    'last_prepared_at', v_last_prepared_at
  );
end;
$$;

revoke all on function public.admin_waitlist_email_queue_summary() from public;
revoke all on function public.admin_waitlist_email_queue_summary() from anon;
grant execute on function public.admin_waitlist_email_queue_summary() to authenticated;

comment on function public.admin_waitlist_email_queue_summary() is
  'INSIDE email queue: returns current eligible recipient count, persisted status totals, and last preparation time. Admin-only; returns no recipient details.';

create or replace function public.admin_prepare_waitlist_email_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_waiting integer;
  v_eligible integer;
  v_added integer;
  v_already_queued integer;
  v_skipped integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The unique email constraint and ON CONFLICT are the final concurrency
  -- guard. A repeated or simultaneous preparation can never duplicate a
  -- normalized address. skipped_count is the waiting-profile count minus
  -- unique valid email addresses, so it includes missing/invalid/internal
  -- emails and additional profiles sharing an address.
  with eligible as materialized (
    select r.user_id, r.email
      from public.waitlist_email_eligible_recipients() r
  ),
  inserted as (
    insert into public.waitlist_email_queue (user_id, email)
    select e.user_id, e.email
      from eligible e
    on conflict (email) do nothing
    returning email
  )
  select
    (select count(*)::integer from eligible),
    (select count(*)::integer from inserted),
    (
      select count(*)::integer
        from public.profiles p
       where p.is_active is distinct from false
         and exists (
           select 1
             from public.profile_photos ph
            where ph.profile_id = p.id
         )
    )
  into v_eligible, v_added, v_waiting;

  v_already_queued := v_eligible - v_added;
  v_skipped := v_waiting - v_eligible;

  -- Keep queue insertion and its audit event in this same transaction.
  -- Only aggregate counts are audited; recipient details remain in the
  -- RLS-protected queue table.
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
      'eligible_count', v_eligible,
      'added_count', v_added,
      'already_queued_count', v_already_queued,
      'skipped_count', v_skipped
    )
  );

  return jsonb_build_object(
    'eligible_count', v_eligible,
    'added_count', v_added,
    'already_queued_count', v_already_queued,
    'skipped_count', v_skipped
  );
end;
$$;

revoke all on function public.admin_prepare_waitlist_email_queue() from public;
revoke all on function public.admin_prepare_waitlist_email_queue() from anon;
grant execute on function public.admin_prepare_waitlist_email_queue() to authenticated;

comment on function public.admin_prepare_waitlist_email_queue() is
  'INSIDE email queue: atomically snapshots currently eligible normalized email addresses and audits aggregate counts. Admin-only; does not send email.';
