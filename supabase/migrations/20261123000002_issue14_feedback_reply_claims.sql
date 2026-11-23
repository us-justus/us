-- us Issue #14 batch 1 — feedback reply idempotency claims (F-12).
--
-- The reply route previously sent through Brevo and only then updated the
-- feedback row. Concurrent/double submissions could both send, replies to
-- resolved feedback were allowed, and a provider success followed by a
-- database failure left no durable way to finish or retry safely.
--
-- ADDITIVE ONLY:
--   1. feedback_reply_attempts: one server-only claim row per feedback
--      (primary key = feedback_id), storing the claim token, the intended
--      reply body, the server-derived replier, and a small state machine.
--      RLS is enabled with NO policies; no anon/authenticated grants.
--   2. Service-role-only, SECURITY DEFINER helpers that:
--      - atomically claim an OPEN, unreplied feedback row (row lock +
--        primary key conflict) and enforce admin membership for the
--        server-derived replier id;
--      - finalize the claim and feedback reply metadata in ONE transaction;
--      - settle failed claims as RELEASED (safe retry) or UNCONFIRMED
--        (provider outcome unknown — no automatic resend);
--      - recover a SENDING/UNCONFIRMED claim after an explicit admin
--        check (sent => record reply without resending; not_sent =>
--        release for a normal retry).
--
-- No RLS weakening, no client grants, no new audit action, no queue or
-- worker machinery. Existing feedback columns/grants are unchanged.

create table if not exists public.feedback_reply_attempts (
  feedback_id uuid primary key
    references public.feedback(id) on delete cascade,
  claim_token uuid not null,
  state text not null
    check (state in ('SENDING', 'UNCONFIRMED', 'SENT', 'RELEASED')),
  reply_body text not null
    check (char_length(reply_body) between 1 and 2000),
  replied_by uuid null references auth.users(id) on delete set null,
  claimed_at timestamptz not null default now(),
  settled_at timestamptz null,
  provider_message_id text null,
  last_error text null
);

alter table public.feedback_reply_attempts enable row level security;

revoke all on table public.feedback_reply_attempts from public, anon, authenticated;
grant select on table public.feedback_reply_attempts to service_role;

comment on table public.feedback_reply_attempts is
  'Server-only idempotency claims for admin feedback email replies. One row per feedback; SENDING is never auto-reclaimed (ambiguous provider outcomes require explicit recovery).';

drop function if exists public.admin_claim_feedback_reply(uuid, uuid, text, uuid);

create or replace function public.admin_claim_feedback_reply(
  p_feedback_id uuid,
  p_claim_token uuid,
  p_reply_body text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_status text;
  v_existing_reply text;
  v_state text;
  v_rows int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_feedback_id is null or p_claim_token is null or p_actor_id is null then
    raise exception 'feedback, claim, and actor are required' using errcode = '22000';
  end if;
  if p_reply_body is null
     or char_length(btrim(p_reply_body)) not between 1 and 2000 then
    raise exception 'invalid reply body' using errcode = '22000';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Serialize claims for one feedback row: concurrent submissions see the
  -- first claim's row and return in_progress instead of sending twice.
  select status, admin_reply into v_status, v_existing_reply
    from public.feedback
   where id = p_feedback_id
   for update;
  if not found then
    raise exception 'feedback not found' using errcode = '02000';
  end if;
  if v_status <> 'OPEN' then
    return jsonb_build_object('ok', false, 'reason', 'resolved');
  end if;
  if v_existing_reply is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_replied');
  end if;

  insert into public.feedback_reply_attempts (
    feedback_id, claim_token, state, reply_body, replied_by,
    claimed_at, settled_at, provider_message_id, last_error
  ) values (
    p_feedback_id, p_claim_token, 'SENDING', btrim(p_reply_body), p_actor_id,
    now(), null, null, null
  )
  on conflict (feedback_id) do update
    set claim_token = excluded.claim_token,
        state = 'SENDING',
        reply_body = excluded.reply_body,
        replied_by = excluded.replied_by,
        claimed_at = now(),
        settled_at = null,
        provider_message_id = null,
        last_error = null
    where public.feedback_reply_attempts.state = 'RELEASED';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select state into v_state
      from public.feedback_reply_attempts
     where feedback_id = p_feedback_id;
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_state = 'SENT' then 'already_replied' else 'in_progress' end
    );
  end if;

  return jsonb_build_object('ok', true, 'state', 'SENDING');
end;
$$;

revoke all on function public.admin_claim_feedback_reply(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_claim_feedback_reply(uuid, uuid, text, uuid) to service_role;

comment on function public.admin_claim_feedback_reply(uuid, uuid, text, uuid) is
  'Atomically claim an OPEN feedback row for one email reply. Service-role only; actor must be a current admin_users member; resolved/already-replied/in-progress claims are refused.';

create or replace function public.admin_finalize_feedback_reply(
  p_feedback_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_body text;
  v_by uuid;
  v_state text;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_feedback_id is null or p_claim_token is null then
    raise exception 'feedback and claim are required' using errcode = '22000';
  end if;

  -- Lock order is feedback -> attempt everywhere (claim/finalize/recover) so
  -- concurrent recovery cannot deadlock against an in-flight finalize.
  perform 1 from public.feedback where id = p_feedback_id for update;

  update public.feedback_reply_attempts
     set state = 'SENT',
         settled_at = now(),
         provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
         last_error = null
   where feedback_id = p_feedback_id
     and claim_token = p_claim_token
     and state = 'SENDING'
  returning reply_body, replied_by into v_body, v_by;

  if not found then
    select state into v_state
      from public.feedback_reply_attempts
     where feedback_id = p_feedback_id;
    return jsonb_build_object(
      'ok', false,
      'reason', coalesce(v_state, 'missing')
    );
  end if;

  -- Same transaction as the SENT transition: the email is already out, so
  -- recording the reply must not be split from resolving the claim.
  update public.feedback
     set admin_reply = v_body,
         replied_at = now(),
         replied_by = v_by,
         brevo_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), '')
   where id = p_feedback_id;

  return jsonb_build_object('ok', true, 'state', 'SENT');
end;
$$;

drop function if exists public.admin_finalize_feedback_reply(uuid, uuid, text);
revoke all on function public.admin_finalize_feedback_reply(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_finalize_feedback_reply(uuid, uuid, text, uuid) to service_role;

comment on function public.admin_finalize_feedback_reply(uuid, uuid, text, uuid) is
  'Record a delivered feedback reply and settle its claim atomically. Service-role only; only the current SENDING claim token may finalize.';

create or replace function public.admin_settle_feedback_reply_claim(
  p_feedback_id uuid,
  p_claim_token uuid,
  p_state text,
  p_last_error text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('RELEASED', 'UNCONFIRMED') then
    raise exception 'invalid settlement state' using errcode = '22000';
  end if;

  update public.feedback_reply_attempts
     set state = p_state,
         settled_at = now(),
         last_error = left(nullif(btrim(coalesce(p_last_error, '')), ''), 500)
   where feedback_id = p_feedback_id
     and claim_token = p_claim_token
     and state = 'SENDING';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'claim_lost');
  end if;
  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

drop function if exists public.admin_settle_feedback_reply_claim(uuid, uuid, text, text);
revoke all on function public.admin_settle_feedback_reply_claim(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_settle_feedback_reply_claim(uuid, uuid, text, text, uuid) to service_role;

comment on function public.admin_settle_feedback_reply_claim(uuid, uuid, text, text, uuid) is
  'Settle a failed feedback reply claim: RELEASED (definitely not sent, retry safe) or UNCONFIRMED (provider outcome ambiguous, no automatic resend). Service-role only.';

create or replace function public.admin_recover_feedback_reply(
  p_feedback_id uuid,
  p_outcome text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_state text;
  v_body text;
  v_by uuid;
  v_provider text;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'not_sent') then
    raise exception 'invalid recovery outcome' using errcode = '22000';
  end if;

  -- Same lock order as claim/finalize (feedback -> attempt).
  perform 1 from public.feedback where id = p_feedback_id for update;

  select state, reply_body, replied_by, provider_message_id
    into v_state, v_body, v_by, v_provider
    from public.feedback_reply_attempts
   where feedback_id = p_feedback_id
   for update;
  if not found then
    raise exception 'reply attempt not found' using errcode = '02000';
  end if;
  if v_state in ('SENT', 'RELEASED') then
    return jsonb_build_object('ok', true, 'state', v_state, 'changed', false);
  end if;

  if p_outcome = 'not_sent' then
    update public.feedback_reply_attempts
       set state = 'RELEASED',
           settled_at = now(),
           last_error = 'recovered: not sent'
     where feedback_id = p_feedback_id;
    return jsonb_build_object('ok', true, 'state', 'RELEASED', 'changed', true);
  end if;

  update public.feedback_reply_attempts
     set state = 'SENT',
         settled_at = now(),
         last_error = null
   where feedback_id = p_feedback_id;

  update public.feedback
     set admin_reply = v_body,
         replied_at = now(),
         replied_by = v_by,
         brevo_message_id = v_provider
   where id = p_feedback_id;

  return jsonb_build_object('ok', true, 'state', 'SENT', 'changed', true);
end;
$$;

drop function if exists public.admin_recover_feedback_reply(uuid, text);
revoke all on function public.admin_recover_feedback_reply(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_recover_feedback_reply(uuid, text, uuid) to service_role;

comment on function public.admin_recover_feedback_reply(uuid, text, uuid) is
  'Explicit admin recovery for an unconfirmed feedback reply claim. sent records the stored reply without resending; not_sent releases the claim for a normal retry. Service-role only.';
