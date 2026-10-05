-- us feedback Step 3: student feedback + admin email replies.
--
-- CONTEXT: the first real outbound-email workflow. A student submits
-- (category + message) from the product; an admin reads it in /inside,
-- replies by email through Brevo to the student's required onboarding
-- email (verification_records.email), and explicitly resolves it. This is
-- an admin feedback workflow, NOT a chat system and NOT campaign/queue
-- infrastructure (no launch emails, no broadcasts, no templates system,
-- no worker/queue, no notification preferences — those belong to a later
-- product-email step).
--
-- REUSES (nothing existing is modified or weakened):
--   - verification_records.email as the trusted recipient source (the same
--     column the inside student directory reads; never client input, never
--     the internal u-...@us.signin.invalid identity).
--   - BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME env config and
--     the api.brevo.com SMTP endpoint conventions from
--     src/lib/email-verification/brevo.ts (reply delivery stays logically
--     separate from verification mail — no verification-queue coupling).
--   - public.inside_audit_events + src/lib/inside/audit.ts for attribution.
--   - requireInsideAdmin() + is_admin() for authorization (defense in depth:
--     routes check the gate AND every function below re-checks is_admin()).
--   - The single-statement CTE pattern (total + page in ONE statement) from
--     the 42P01 fix (20261011000002).
--
-- ADDS:
--   1. public.feedback — student-authored rows (category, message, status)
--      plus admin reply metadata (admin_reply, replied_at, replied_by,
--      brevo_message_id) and resolution metadata (resolved_at, resolved_by).
--      RLS: own insert + own select for authenticated (mirrors reports);
--      admin reads/writes go through SECURITY DEFINER RPCs + the
--      server-only service-role client. No client UPDATE/DELETE policy, so
--      students can never resolve, reply, or touch another student's rows.
--   2. Two audit actions on the CHECK constraint: FEEDBACK_REPLIED,
--      FEEDBACK_RESOLVED. The six permanent actions are kept exactly; no
--      launch action is reintroduced.
--   3. admin_list_feedback() — SECURITY DEFINER paginated inbox with
--      student context (username, nickname, USN, email). Open-first
--      ordering (OPEN rows newest-first, then RESOLVED newest-first) with
--      an optional status filter.
--   4. admin_resolve_feedback() — SECURITY DEFINER resolver (OPEN ->
--      RESOLVED only). Returns previous/new state plus a changed flag so
--      no-ops record no audit event.
--
-- STATUS MODEL (deliberately small): 'OPEN' / 'RESOLVED' only. Replying
-- does NOT resolve; resolving sends NO email. No PENDING / IN_PROGRESS /
-- WAITING_FOR_USER / ARCHIVED.
--
-- EMAIL RELIABILITY (documented limitation, no queue built in this step):
-- the reply route sends through Brevo FIRST and persists reply metadata
-- only on success, so a Brevo failure leaves the row unchanged. The
-- inverse failure (Brevo accepted, DB persist failed) cannot be retried
-- blindly — the route returns emailSent:true with a do-not-retry message
-- and the admin checks the row before resending. Audit for replies is
-- best-effort for the same reason (an email cannot be unsent); resolve
-- stays fail-closed with compensation like the other privileged writers.
--
-- SECURITY MODEL (mirrors admin_overview_counts / moderation RPCs):
--   - All functions refuse unless is_admin(). Direct invocation by a
--     student session raises 42501 and changes nothing.
--   - EXECUTE granted to authenticated only; revoked from public/anon. No
--     service-role grant, no RLS weakening, auth.users never read.
--
-- ROLLBACK: drop the two functions, drop table public.feedback, then
-- restore the six-action CHECK (see the down-migration sketch at the end).

-- ============================================================
-- PART 1 — feedback table
-- ============================================================
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Canonical category vocabulary (UI labels may differ). No arbitrary
  -- client values: enforced here and re-validated server-side.
  category text not null check (category in (
    'BUG',
    'FEATURE',
    'ACCOUNT',
    'SAFETY',
    'OTHER'
  )),
  message text not null check (char_length(message) between 1 and 2000),
  -- Minimal state machine: replying does not resolve; resolving sends
  -- no email. Both transitions are explicit admin actions.
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Reply metadata: written ONLY after Brevo accepts the message.
  admin_reply text null check (admin_reply is null or char_length(admin_reply) between 1 and 2000),
  replied_at timestamptz null,
  replied_by uuid null references auth.users(id) on delete set null,
  brevo_message_id text null,
  -- Resolution metadata: written ONLY by the explicit resolve action.
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id) on delete set null
);

drop trigger if exists trg_feedback_updated on public.feedback;
create trigger trg_feedback_updated before update on public.feedback
for each row execute function public.handle_updated_at();

create index if not exists idx_feedback_user_id on public.feedback(user_id);
create index if not exists idx_feedback_status_created on public.feedback(status, created_at desc);

alter table public.feedback enable row level security;

-- Students create their own rows and read their own history. No UPDATE /
-- DELETE policy: resolution and replies are admin-only (service-role /
-- SECURITY DEFINER paths), and no student can touch another student's rows.
drop policy if exists "own feedback insert" on public.feedback;
create policy "own feedback insert" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own feedback select" on public.feedback;
create policy "own feedback select" on public.feedback
  for select to authenticated using (auth.uid() = user_id);

-- Data API grants: SELECT (own history + throttle count) + INSERT
-- (submission). No UPDATE/DELETE grant: there is no client UPDATE/DELETE
-- policy, so the grant would be inert — and inert write surface is not
-- added on principle.
grant select, insert on table public.feedback to authenticated;

comment on table public.feedback is
  'Student feedback for the admin inbox + one-way admin email replies. Students own-insert/own-select via RLS; admin reads via admin_list_feedback() and writes via the reply/resolve routes (service-role + SECURITY DEFINER). Status is OPEN/RESOLVED only.';

-- ============================================================
-- PART 2 — extend the audit CHECK (drop + re-add: Postgres cannot
-- ALTER a CHECK list in place). Keeps the six permanent actions
-- exactly; adds FEEDBACK_REPLIED + FEEDBACK_RESOLVED; reintroduces
-- NO launch action.
-- ============================================================
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
    'FEEDBACK_RESOLVED'
  ));

-- ============================================================
-- PART 3 — admin_list_feedback()
-- ============================================================
create or replace function public.admin_list_feedback(
  p_status text default 'open',
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
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_status not in ('open', 'resolved', 'all') then
    raise exception 'invalid feedback status filter' using errcode = '22000';
  end if;

  -- Single statement: every CTE below is visible to the whole query
  -- (staging 42P01 regression pattern). OPEN rows sort before RESOLVED
  -- (the inbox default is the work queue); newest-first within each band.
  -- Student context is public profile fields + the trusted onboarding
  -- email — auth.users is never read.
  with base as (
    select
      f.id as id,
      f.user_id as user_id,
      f.category as category,
      f.message as message,
      f.status as status,
      f.created_at as created_at,
      f.admin_reply as admin_reply,
      f.replied_at as replied_at,
      f.resolved_at as resolved_at,
      p.username as username,
      p.nickname as nickname,
      v.usn as usn,
      v.email as email
    from public.feedback f
    left join public.profiles p on p.user_id = f.user_id
    left join public.verification_records v on v.user_id = f.user_id
    where (v_status = 'all')
       or (v_status = 'open' and f.status = 'OPEN')
       or (v_status = 'resolved' and f.status = 'RESOLVED')
  ),
  total as (
    select count(*) as n from base
  )
  select jsonb_build_object(
    'feedback',
    coalesce(
      (
        select jsonb_agg(r order by (r.status = 'OPEN') desc, r.created_at desc)
        from (
          select * from base
          order by (status = 'OPEN') desc, created_at desc
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

revoke all on function public.admin_list_feedback(text, int, int) from public;
revoke all on function public.admin_list_feedback(text, int, int) from anon;
grant execute on function public.admin_list_feedback(text, int, int) to authenticated;

comment on function public.admin_list_feedback(text, int, int) is
  'INSIDE feedback inbox: paginated listing (open/resolved/all, default open) with student context (username/nickname/USN/trusted email). Admin-only; never auth-schema internals.';

-- ============================================================
-- PART 4 — admin_resolve_feedback()
-- ============================================================
create or replace function public.admin_resolve_feedback(
  p_feedback_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_feedback_id is null then
    raise exception 'feedback id is required' using errcode = '22000';
  end if;

  select status into v_prev
    from public.feedback
   where id = p_feedback_id;

  if not found then
    raise exception 'feedback not found' using errcode = '02000';
  end if;

  if v_prev = 'RESOLVED' then
    -- No-op: already resolved. The route records no audit event.
    return jsonb_build_object(
      'id', p_feedback_id,
      'previous_status', v_prev,
      'new_status', v_prev,
      'changed', false
    );
  end if;

  update public.feedback
     set status = 'RESOLVED',
         resolved_at = now(),
         -- Caller identity: SECURITY DEFINER keeps the caller's JWT, so
         -- auth.uid() is the resolving admin (same basis as is_admin()).
         -- Never accepted as a parameter — no caller-supplied actor.
         resolved_by = auth.uid()
   where id = p_feedback_id;

  return jsonb_build_object(
    'id', p_feedback_id,
    'previous_status', v_prev,
    'new_status', 'RESOLVED',
    'changed', true
  );
end;
$$;

revoke all on function public.admin_resolve_feedback(uuid) from public;
revoke all on function public.admin_resolve_feedback(uuid) from anon;
grant execute on function public.admin_resolve_feedback(uuid) to authenticated;

comment on function public.admin_resolve_feedback(uuid) is
  'INSIDE feedback: explicit OPEN -> RESOLVED transition. Admin-only; no-op when already resolved so routes can skip audit. Replying never resolves; resolving never emails.';

-- ROLLBACK (down-migration sketch, not executed here):
--   drop function public.admin_resolve_feedback(uuid);
--   drop function public.admin_list_feedback(text, int, int);
--   alter table public.inside_audit_events drop constraint inside_audit_events_action_check;
--   alter table public.inside_audit_events add constraint inside_audit_events_action_check
--     check (action in ('ADMIN_LOGIN_SUCCESS','ADMIN_LOGIN_FAILURE','ADMIN_LOGOUT',
--       'STUDENT_SUSPENDED','STUDENT_RESTORED','REPORT_RESOLVED'));
--   drop table public.feedback;
