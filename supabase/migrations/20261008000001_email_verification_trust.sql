-- us EMAIL VERIFICATION TRUST (staging-only vertical slice).
--
-- SCOPE: ownership proof for an email already associated with the SAME
-- auth.users.id (verification_records.user_id — no second account, no signUp,
-- no UID change). Production login/recovery untouched: an unverified email
-- (email_verified_at IS NULL) must never be trusted for recovery; only this
-- slice's consume function may set the trust timestamp.
--
-- ARCHITECTURE (token + queue retry):
-- The delivery queue (20261007000001/2) never stores tokens — by design it
-- cannot reconstruct a plaintext token from sha256(token) after a worker
-- crash or a Brevo 429. So tokens are minted JUST-IN-TIME, once per actual
-- delivery attempt, by the verification worker's sender wrapper (see
-- src/lib/email-verification/worker.ts): the queue's expiry/cooldown gates
-- pass first, then the worker mints a fresh token (invalidating any
-- predecessors for that user+email), builds the URL in memory, and sends.
-- Retries therefore never reconstruct plaintext — they mint anew. Only the
-- latest delivered link is valid; older links fail closed.
--
-- TABLES:
--   verification_records.email_verified_at — trusted ownership state. Set ONLY
--     server-side (consume function / server email-change reset). Client RLS
--     updates can never write it: the guard trigger below rejects anon/
--     authenticated roles. The legacy email_verified boolean is dead/
--     untrusted and left untouched.
--   email_verification_tokens — hash-only token store. token_hash is
--     sha256 hex of a 256-bit base64url secret; plaintext is never persisted.
--
-- EMAIL UNIQUENESS: staging audit (2026-10-07) found 4 verification_records
-- rows and zero non-null emails, and the current architecture has no email
-- uniqueness requirement (trust is per-user). No email unique constraint is
-- added here.
--
-- SECURITY: tokens table RLS-enabled with NO policies and NO grants to
-- anon/authenticated/public (fail-closed, same pattern as the queue).
-- mint/consume functions are SECURITY DEFINER with fixed search_path,
-- granted to service_role ONLY.

-- ============================================================
-- 1. Trusted ownership state on verification_records
-- ============================================================
alter table public.verification_records
  add column if not exists email_verified_at timestamptz;

comment on column public.verification_records.email_verified_at is
  'Cryptographic inbox-ownership proof: non-null means the user controlled this email (custom token consumed). Server-managed only — client writes rejected by guard trigger. Distinct from legacy email_verified (dead/untrusted).';

-- ============================================================
-- 2. Hash-only token table
-- ============================================================
create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_email text not null
    check (char_length(normalized_email) >= 3 and char_length(normalized_email) <= 320),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  check (expires_at > created_at)
);

comment on table public.email_verification_tokens is
  'Email-ownership tokens, hash-only: token_hash = sha256 hex of a 256-bit secret. Plaintext never stored. One active token per user+email enforced by mint-time invalidation. Service-role/server only.';

create index if not exists email_verification_tokens_owner_idx
  on public.email_verification_tokens (user_id, normalized_email);

alter table public.email_verification_tokens enable row level security;

-- Fail-closed: no policies; revoke every client-facing role.
revoke all on table public.email_verification_tokens from public;
revoke all on table public.email_verification_tokens from anon;
revoke all on table public.email_verification_tokens from authenticated;

-- ============================================================
-- 3. Trust guard trigger (verification_records)
-- ============================================================
-- email_verified_at may change ONLY via server-side paths (service_role JWT
-- or direct SQL with no client JWT). anon/authenticated PostgREST writes —
-- i.e. every client-side RLS update — are rejected, so a client can never
-- self-certify inbox ownership. The consume/mint functions run as
-- service_role; the request-path server upsert runs as service_role.
create or replace function public.guard_email_verified_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if TG_OP = 'UPDATE' and NEW.email_verified_at is not distinct from OLD.email_verified_at then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.email_verified_at is null then
    return NEW;
  end if;
  begin
    v_role := auth.role();
  exception when others then
    v_role := null;
  end;
  if v_role is null or v_role = 'service_role' then
    return NEW;
  end if;
  raise exception 'email_verified_at is server-managed';
end;
$$;

drop trigger if exists trg_guard_email_verified_at_ins on public.verification_records;
create trigger trg_guard_email_verified_at_ins
  before insert on public.verification_records
  for each row execute function public.guard_email_verified_at();

drop trigger if exists trg_guard_email_verified_at_upd on public.verification_records;
create trigger trg_guard_email_verified_at_upd
  before update on public.verification_records
  for each row execute function public.guard_email_verified_at();

-- ============================================================
-- 4. mint_email_verification_token() — one active token per user+email
-- ============================================================
-- Invalidates competing active tokens for (user_id, email), then inserts the
-- new hash (15-min TTL from the caller). Concurrent mints serialize on the
-- invalidation UPDATE; a residual double-mint still binds both tokens to the
-- SAME user+email, and consume invalidates siblings — no privilege gained.
create or replace function public.mint_email_verification_token(
  p_user_id uuid,
  p_normalized_email text,
  p_token_hash text,
  p_ttl_seconds integer
)
returns table (token_id uuid, token_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_ttl integer;
  v_id uuid;
  v_exp timestamptz;
begin
  if p_user_id is null then
    raise exception 'bad_user';
  end if;
  v_email := lower(trim(coalesce(p_normalized_email, '')));
  if char_length(v_email) < 3 or char_length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'bad_email';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_token_hash';
  end if;
  v_ttl := coalesce(p_ttl_seconds, 900);
  if v_ttl < 60 or v_ttl > 1800 then
    raise exception 'bad_ttl';
  end if;

  update public.email_verification_tokens
     set invalidated_at = now()
   where user_id = p_user_id
     and normalized_email = v_email
     and consumed_at is null
     and invalidated_at is null;

  insert into public.email_verification_tokens (user_id, normalized_email, token_hash, expires_at)
  values (p_user_id, v_email, p_token_hash, now() + make_interval(secs => v_ttl))
  returning id, expires_at into v_id, v_exp;

  token_id := v_id;
  token_expires_at := v_exp;
  return next;
end;
$$;

revoke all on function public.mint_email_verification_token(uuid, text, text, integer) from public;
revoke all on function public.mint_email_verification_token(uuid, text, text, integer) from anon;
revoke all on function public.mint_email_verification_token(uuid, text, text, integer) from authenticated;
grant execute on function public.mint_email_verification_token(uuid, text, text, integer) to service_role;

comment on function public.mint_email_verification_token(uuid, text, text, integer) is
  'Mint one active verification token per user+email (invalidates predecessors, inserts hash, 60..1800s TTL). Hash-only; plaintext never reaches the DB. Service-role only.';

-- ============================================================
-- 5. consume_email_verification_token() — atomic single-use consume
-- ============================================================
-- Single UPDATE consumes the token (hash match + unconsumed + uninvalidated
-- + unexpired); concurrent consumes serialize on the row lock so exactly one
-- succeeds. The trust update is bound to the SAME user+email: if the record
-- email changed since mint, the whole transaction rolls back (token stays
-- valid-but-unusable; the next mint invalidates it). Siblings are
-- invalidated so only the consumed token ever counts.
create or replace function public.consume_email_verification_token(
  p_token_hash text
)
returns table (verified_user_id uuid, verified_email text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid;
  v_email text;
  v_rec_email text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token';
  end if;

  update public.email_verification_tokens t
     set consumed_at = now()
   where t.token_hash = p_token_hash
     and t.consumed_at is null
     and t.invalidated_at is null
     and t.expires_at > now()
  returning t.id, t.user_id, t.normalized_email into v_id, v_uid, v_email;

  if v_id is null then
    raise exception 'invalid_token';
  end if;

  select vr.email into v_rec_email
    from public.verification_records vr
   where vr.user_id = v_uid;

  if v_rec_email is null or lower(v_rec_email) != v_email then
    raise exception 'email_changed';
  end if;

  update public.verification_records
     set email_verified_at = now()
   where user_id = v_uid;

  update public.email_verification_tokens
     set invalidated_at = now()
   where user_id = v_uid
     and normalized_email = v_email
     and id <> v_id
     and consumed_at is null
     and invalidated_at is null;

  verified_user_id := v_uid;
  verified_email := v_email;
  return next;
end;
$$;

revoke all on function public.consume_email_verification_token(text) from public;
revoke all on function public.consume_email_verification_token(text) from anon;
revoke all on function public.consume_email_verification_token(text) from authenticated;
grant execute on function public.consume_email_verification_token(text) to service_role;

comment on function public.consume_email_verification_token(text) is
  'Atomically consume one verification token and set verification_records.email_verified_at for the same user+email. Exactly-once under concurrency. Service-role only.';
