-- Explicit, audited reconciliation for uncertain waitlist email sends.
-- A human confirms the provider outcome; this function never sends email.
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
    'WAITLIST_EMAIL_SENT',
    'WAITLIST_EMAIL_RECONCILED'
  ));

create or replace function public.admin_reconcile_waitlist_email_queue(
  p_actor_id uuid,
  p_queue_id uuid,
  p_expected_updated_at timestamptz,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_status text;
  v_attempts integer;
  v_updated_at timestamptz;
  v_new_status text;
begin
  if p_actor_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_id
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_queue_id is null or p_expected_updated_at is null
     or p_outcome not in ('sent', 'not_sent') then
    raise exception 'invalid reconciliation request' using errcode = '22000';
  end if;

  select q.status, q.attempts, q.updated_at
    into v_status, v_attempts, v_updated_at
    from public.waitlist_email_queue q
   where q.id = p_queue_id
   for update;
  if not found then
    raise exception 'queue row not found' using errcode = '02000';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'queue row changed; refresh before reconciling' using errcode = '40001';
  end if;
  if v_status <> 'SENDING' then
    raise exception 'only SENDING rows can be reconciled' using errcode = '22000';
  end if;

  if p_outcome = 'sent' then
    v_new_status := 'SENT';
    update public.waitlist_email_queue
       set status = 'SENT',
           sent_at = coalesce(sent_at, now()),
           last_error = null
     where id = p_queue_id;
  else
    v_new_status := 'FAILED';
    update public.waitlist_email_queue
       set status = 'FAILED',
           next_attempt_at = now(),
           last_error = 'manual reconciliation: confirmed not sent'
     where id = p_queue_id;
  end if;

  insert into public.inside_audit_events
    (actor_user_id, action, target_type, target_id, metadata)
  values
    (p_actor_id, 'WAITLIST_EMAIL_RECONCILED',
     'waitlist_email_queue', p_queue_id::text,
     jsonb_build_object(
       'outcome', p_outcome,
       'previous_status', v_status,
       'new_status', v_new_status,
       'attempts', v_attempts
     ));

  return jsonb_build_object(
    'id', p_queue_id,
    'status', v_new_status,
    'outcome', p_outcome,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function public.admin_reconcile_waitlist_email_queue(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.admin_reconcile_waitlist_email_queue(uuid, uuid, timestamptz, text)
  to service_role;

comment on function public.admin_reconcile_waitlist_email_queue(uuid, uuid, timestamptz, text) is
  'INSIDE email queue: admin confirms an uncertain SENDING row as sent or not_sent. Uses updated_at optimistic concurrency, never sends email, and never resets directly to PENDING.';
