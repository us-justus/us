-- us EMAIL VERIFICATION QUEUE (staging-only vertical slice).
--
-- SCOPE: delivery infrastructure ONLY. Verification-token issuance/validation
-- is a separate future task. This queue stores DELIVERY state only and never
-- stores plaintext verification tokens (there is no token column by design;
-- the future token system will supply the verification URL at send time).
--
-- STATE MACHINE (minimal; each state exists for a concrete reason):
--   pending  — work waiting to be claimed (including scheduled retries:
--               next_retry_at is the gate, not a separate state).
--   sending  — claimed under a lease (lease_owner + lease_expires_at). Exists
--               so concurrent workers can distinguish "being processed" from
--               "available". Never a terminal state.
--   sent     — Brevo accepted the message (HTTP 201). Terminal. Stores the
--               provider message id for operations.
--   failed   — permanent failure (4xx-class, 401 config error, attempts
--               exhausted). Terminal. Never retried.
--   expired  — the delivery window lapsed before a send completed. Terminal
--               and non-sendable. Exists so the worker has an explicit
--               "do not send" outcome instead of silently dropping rows.
-- Deliberately OMITTED: verified (verification-domain, outside this slice),
-- and any queued/scheduled/inflight extra states (next_retry_at + lease cover
-- them without speculative states).
--
-- TRANSITIONS:
--   pending -> sending   (atomic claim, FOR UPDATE SKIP LOCKED + lease)
--   sending -> sent      (Brevo 201)
--   sending -> pending   (429 / quota / temporary failure: attempts+1,
--                         next_retry_at set, lease cleared)
--   sending -> failed    (permanent 4xx / 401 / max attempts)
--   pending -> expired   (expires_at passed; swept, never sent)
--   sending -> expired   (expires_at passed AND lease lapsed; a live lease is
--                         never expired mid-flight — expiry is a pre-send gate,
--                         so a send already accepted by Brevo is recorded sent)
--
-- DEDUPLICATION: dedupe_key = sha256 hex of "<user_id>|<normalized email>"
-- computed server-side (Node crypto). Normalization is defined in
-- src/lib/email-verification/queue.ts as trim + lowercase ONLY (no
-- plus-tag/dot manipulation: provider-specific rewriting risks merging two
-- distinct mailboxes). The partial unique index below is the hard guard:
-- one ACTIVE (pending/sending) row per user+email. Terminal rows
-- (sent/failed/expired) do not conflict, so a new request after a terminal
-- outcome creates fresh work.
--
-- LEASE: default 120s (worker passes 10..900s). A crashed worker's row
-- becomes claimable again once lease_expires_at passes; attempts are only
-- incremented when a processing attempt COMPLETES (finalize), so a crash
-- never burns an attempt. Post-claim updates are guarded by
-- (id, lease_owner, status='sending') so a stale worker cannot clobber a
-- row re-claimed by someone else.
--
-- PROVIDER COOLDOWN: public.email_provider_state holds one row per provider
-- ('brevo'). After a 429/quota signal the worker sets cooldown_until so ALL
-- workers pause Brevo calls until that time (survives restarts; no memory
-- state, no extra infra). The claim function refuses to hand out work while
-- a cooldown is active.
--
-- SECURITY: both tables RLS-enabled with NO policies and NO grants to
-- anon/authenticated/public (fail-closed, same pattern as
-- login_rate_buckets). Service-role bypasses RLS server-side; the claim/
-- expire functions are SECURITY DEFINER with fixed search_path, granted to
-- service_role ONLY. No client path exists.
-- Staging-only slice: additive migration, no existing object touched.

-- ============================================================
-- 1. Queue table
-- ============================================================
create table if not exists public.email_verification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_category text,
  last_error text,
  provider_message_id text,
  expires_at timestamptz not null default (now() + make_interval(mins => 15)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(email) >= 3 and char_length(email) <= 320),
  check ((status = 'sending' and lease_owner is not null and lease_expires_at is not null)
      or (status <> 'sending'))
);

comment on table public.email_verification_queue is
  'Staging email-verification DELIVERY queue. No tokens stored (delivery state only). dedupe_key = sha256(user_id|normalized_email). Service-role/server only.';

-- One active (pending/sending) item per user+email. Terminal rows exempt.
create unique index if not exists email_verification_queue_active_dedupe
  on public.email_verification_queue (dedupe_key)
  where status in ('pending', 'sending');

-- Claim-order scan: only due, unexpired, unleashed rows, oldest first.
create index if not exists email_verification_queue_claim_idx
  on public.email_verification_queue (status, next_retry_at, created_at)
  where status = 'pending';

create index if not exists email_verification_queue_user_idx
  on public.email_verification_queue (user_id);

alter table public.email_verification_queue enable row level security;

-- Fail-closed: no policies; revoke every client-facing role.
revoke all on table public.email_verification_queue from public;
revoke all on table public.email_verification_queue from anon;
revoke all on table public.email_verification_queue from authenticated;

-- ============================================================
-- 2. Provider cooldown state (one row per provider)
-- ============================================================
create table if not exists public.email_provider_state (
  provider text primary key,
  cooldown_until timestamptz,
  consecutive_rate_limits integer not null default 0 check (consecutive_rate_limits >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.email_provider_state is
  'Provider-level send cooldown (e.g. brevo quota/429). Workers check cooldown_until before any Brevo call; set on 429/quota. Service-role/server only.';

alter table public.email_provider_state enable row level security;

revoke all on table public.email_provider_state from public;
revoke all on table public.email_provider_state from anon;
revoke all on table public.email_provider_state from authenticated;

-- ============================================================
-- 3. claim_email_verification_job() — atomic claim under lease
-- ============================================================
-- Short transaction: SELECT ... FOR UPDATE SKIP LOCKED, then stamp the
-- lease. The caller MUST NOT hold this transaction open across the Brevo
-- HTTP call: claim returns, the HTTP happens outside any txn, then a
-- separate guarded UPDATE finalizes. Returns zero rows when there is no
-- claimable work OR a provider cooldown is active.
create or replace function public.claim_email_verification_job(
  p_lease_owner text,
  p_lease_seconds integer
)
returns setof public.email_verification_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lease integer;
begin
  if p_lease_owner is null or p_lease_owner = '' then
    raise exception 'lease owner required';
  end if;
  v_lease := coalesce(p_lease_seconds, 0);
  if v_lease < 10 or v_lease > 900 then
    raise exception 'lease seconds out of range (10..900)';
  end if;

  -- Global provider cooldown gate: no claims while Brevo is cooling down.
  perform 1 from public.email_provider_state
   where provider = 'brevo' and cooldown_until is not null and cooldown_until > now();
  if found then
    return;
  end if;

  return query
  with candidate as (
    select q.id
      from public.email_verification_queue q
     where q.status = 'pending'
       and q.next_retry_at <= now()
       and q.expires_at > now()
       and (q.lease_expires_at is null or q.lease_expires_at <= now())
     order by q.next_retry_at asc, q.created_at asc
     limit 1
     for update skip locked
  )
  update public.email_verification_queue q
     set status = 'sending',
         lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => v_lease),
         updated_at = now()
    from candidate c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_email_verification_job(text, integer) from public;
revoke all on function public.claim_email_verification_job(text, integer) from anon;
revoke all on function public.claim_email_verification_job(text, integer) from authenticated;
grant execute on function public.claim_email_verification_job(text, integer) to service_role;

comment on function public.claim_email_verification_job(text, integer) is
  'Email queue atomic claim: SKIP LOCKED + lease stamp. Refuses work during provider cooldown. Service-role only. Never hold open across the Brevo call.';

-- ============================================================
-- 4. expire_email_verification_jobs() — sweep lapsed windows
-- ============================================================
-- Marks pending rows past expires_at as expired (never sent). A sending
-- row is only expired once its lease has lapsed (never mid-flight under a
-- live lease). Returns the number of rows expired. Attempts are NOT
-- incremented by the sweep (no processing attempt occurred).
create or replace function public.expire_email_verification_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_verification_queue q
     set status = 'expired',
         lease_owner = null,
         lease_expires_at = null,
         last_error_category = 'expired',
         updated_at = now()
   where q.expires_at <= now()
     and (q.status = 'pending'
       or (q.status = 'sending'
           and (q.lease_expires_at is null or q.lease_expires_at <= now())));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_email_verification_jobs() from public;
revoke all on function public.expire_email_verification_jobs() from anon;
revoke all on function public.expire_email_verification_jobs() from authenticated;
grant execute on function public.expire_email_verification_jobs() to service_role;

comment on function public.expire_email_verification_jobs() is
  'Email queue expiry sweep: pending past expires_at -> expired; sending only after lease lapse. Service-role only.';
