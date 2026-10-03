-- us STEP 3 (login abuse protection): close direct anon access to the
-- password-gated login resolvers and add a DB-backed distributed-safe login
-- rate limiter. Additive only; no RLS weakened; no existing behavior changed.
--
-- PART A — close the public RPC surface:
--   - REVOKE EXECUTE on resolve_login_email + resolve_phone_login_email from
--     anon (they previously granted anon + authenticated). The functions stay
--     SECURITY DEFINER with a fixed search_path; only the GRANTS change.
--   - After this migration the public anon PostgREST key receives
--     "permission denied" on rpc("resolve_login_email", ...). The sanctioned
--     callers (POST /api/auth/login, POST /api/inside/login) invoke the
--     functions server-side through the service-role key, which never leaves
--     the server (never NEXT_PUBLIC_*, never logged, never returned).
--   - authenticated keeps EXECUTE so logged-in server code paths that already
--     hold a user session keep working; service_role is granted explicitly.
--
-- PART B — rate-limit storage (login_rate_buckets):
--   - WHAT IS STORED: bucket_key (PK, text) + attempt_count + window_start.
--     bucket_key values are hex sha256 digests computed server-side in the
--     API route ("ip:<hex>" / "ip-usn:<hex>"); raw IPs, USNs, and passwords
--     are NEVER stored. Passwords never reach these functions at all.
--   - WHY: shared counters so any app instance behind any replica sees the
--     same login-attempt state (process-local Maps are banned by the brief).
--   - PRIVILEGES: RLS enabled with NO policies (fail-closed) and NO table
--     grants to anon/authenticated/public. All reads/writes happen inside the
--     SECURITY DEFINER functions below (fixed search_path), which are granted
--     to service_role ONLY — normal clients have no path to the table or the
--     functions through the anon key.
--   - RETENTION/CLEANUP: rows live at most one window (900s) past their
--     window_start. Each check_login_rate_limit() call opportunistically
--     deletes expired rows; successful logins delete the caller's
--     per-(IP,USN) bucket via clear_login_rate_limit(). There is no separate
--     cron yet — see deployment follow-up below. This table is a throttle,
--     never an analytics/event log.
--
-- LIMITS (provisional — clearly marked, easy to tune, not security guarantees):
--   - LOGIN_RATE_LIMIT_WINDOW_SECONDS = 900 (15 min fixed window per bucket)
--   - LOGIN_RATE_LIMIT_MAX_PER_IP = 100 attempts / window (tolerant: campus
--     NAT shares one egress IP across many students; a single failure must
--     never block normal users)
--   - LOGIN_RATE_LIMIT_MAX_PER_IP_USN = 10 attempts / window (targeted:
--     bounds password-guessing against one USN from one source without a
--     global per-USN lockout an attacker could use to lock someone else out)
--
-- IP TRUST MODEL: the app has no declared hosting platform, so there is no
-- trustworthy proxy-provided source IP yet. getClientIp() (route-side) prefers
-- x-forwarded-for[0] -> x-real-ip -> "unknown". That header is
-- client-influenceable under the current runtime, so the key is
-- attacker-influenced until a trusted proxy (allowlisted headers / platform
-- property) is configured. The interim design still bounds cost per key and
-- never locks a USN globally; the follow-up is to bind IP extraction to the
-- deployment (e.g. platform-verified connecting-IP header or proxy allowlist)
-- and re-tune the IP threshold then.
--
-- FAILURE BEHAVIOR: if the limiter function itself errors, routes FAIL OPEN
-- for the limiter only (login continues to real authentication) and log a
-- server-side generic marker with no secrets. RATE LIMIT FAILURE NEVER MEANS
-- AUTHORIZATION SUCCESS: if PostgreSQL/Auth is down, resolve/sign-in fail and
-- the route returns 401/503 exactly as today — an outage never authenticates.

-- NOTE: Supabase auto-grants EXECUTE on newly created public functions to
-- anon/authenticated/service_role at creation time, so revoking the PUBLIC
-- pseudo-role alone is NOT sufficient — explicit per-role REVOKEs below are
-- load-bearing (verified: PUBLIC-only revoke left anon EXECUTE intact).
-- ============================================================
-- 1. Close anon EXECUTE on the login resolvers
-- ============================================================
revoke all on function public.resolve_login_email(text, text) from public;
revoke all on function public.resolve_login_email(text, text) from anon;
grant execute on function public.resolve_login_email(text, text) to authenticated, service_role;

revoke all on function public.resolve_phone_login_email(text, text) from public;
revoke all on function public.resolve_phone_login_email(text, text) from anon;
grant execute on function public.resolve_phone_login_email(text, text) to authenticated, service_role;

-- ============================================================
-- 2. Rate-limit bucket table (server/function-controlled only)
-- ============================================================
create table if not exists public.login_rate_buckets (
  bucket_key text primary key,
  attempt_count integer not null default 1 check (attempt_count >= 0),
  window_start timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.login_rate_buckets enable row level security;

-- Fail-closed: no policies (every client role denied) and no table grants.
revoke all on table public.login_rate_buckets from public;
revoke all on table public.login_rate_buckets from anon;
revoke all on table public.login_rate_buckets from authenticated;

comment on table public.login_rate_buckets is
  'Login abuse protection: fixed-window attempt counters keyed by sha256-hashed "ip:<hex>" / "ip-usn:<hex>" bucket keys. No raw IPs, USNs, or passwords. Server-side RPC access only.';

-- ============================================================
-- 3. check_login_rate_limit() — atomic check-and-increment
-- ============================================================
-- Increments BOTH buckets for this attempt and reports whether either limit
-- is exceeded. Increment-before-check so the triggering attempt counts
-- itself; both buckets increment even when one is throttled so the response
-- never reveals which dimension triggered.
create or replace function public.check_login_rate_limit(p_ip_key text, p_ip_usn_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := 900;
  v_max_per_ip integer := 100;
  v_max_per_ip_usn integer := 10;
  v_window interval := make_interval(secs => 900);
  v_ip_count integer := 0;
  v_ip_window timestamptz := v_now;
  v_usn_count integer := 0;
  v_usn_window timestamptz := v_now;
  v_retry integer := 0;
begin
  if p_ip_key is null or p_ip_key = '' or p_ip_usn_key is null or p_ip_usn_key = '' then
    -- Fail open on malformed keys (never block on a limiter bug); callers
    -- still run full authentication.
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  -- Opportunistic expiry: keeps retention bounded to one active window
  -- without a separate cleanup job.
  delete from public.login_rate_buckets
   where window_start < v_now - v_window;

  -- Per-IP bucket: reset when the window lapsed, else increment.
  insert into public.login_rate_buckets (bucket_key, attempt_count, window_start, updated_at)
  values (p_ip_key, 1, v_now, v_now)
  on conflict (bucket_key) do update
     set attempt_count = case
                           when public.login_rate_buckets.window_start < v_now - v_window then 1
                           else public.login_rate_buckets.attempt_count + 1
                         end,
         window_start = case
                          when public.login_rate_buckets.window_start < v_now - v_window then v_now
                          else public.login_rate_buckets.window_start
                        end,
         updated_at = v_now
  returning attempt_count, window_start into v_ip_count, v_ip_window;

  -- Per-(IP, USN) bucket: same fixed-window semantics.
  insert into public.login_rate_buckets (bucket_key, attempt_count, window_start, updated_at)
  values (p_ip_usn_key, 1, v_now, v_now)
  on conflict (bucket_key) do update
     set attempt_count = case
                           when public.login_rate_buckets.window_start < v_now - v_window then 1
                           else public.login_rate_buckets.attempt_count + 1
                         end,
         window_start = case
                          when public.login_rate_buckets.window_start < v_now - v_window then v_now
                          else public.login_rate_buckets.window_start
                        end,
         updated_at = v_now
  returning attempt_count, window_start into v_usn_count, v_usn_window;

  if v_ip_count > v_max_per_ip or v_usn_count > v_max_per_ip_usn then
    if v_ip_count > v_max_per_ip and v_usn_count > v_max_per_ip_usn then
      v_retry := greatest(
        ceil(extract(epoch from ((v_ip_window + v_window) - v_now))),
        ceil(extract(epoch from ((v_usn_window + v_window) - v_now)))
      );
    elsif v_ip_count > v_max_per_ip then
      v_retry := ceil(extract(epoch from ((v_ip_window + v_window) - v_now)));
    else
      v_retry := ceil(extract(epoch from ((v_usn_window + v_window) - v_now)));
    end if;
    if v_retry < 0 then v_retry := 0; end if;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry);
  end if;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.check_login_rate_limit(text, text) from public;
revoke all on function public.check_login_rate_limit(text, text) from anon;
revoke all on function public.check_login_rate_limit(text, text) from authenticated;
grant execute on function public.check_login_rate_limit(text, text) to service_role;

comment on function public.check_login_rate_limit(text, text) is
  'Login abuse protection: fixed-window check-and-increment over hashed per-IP and per-(IP,USN) buckets. Provisional limits 100/IP + 10/(IP,USN) per 900s. Service-role only; fail-open on limiter error, never auth success.';

-- ============================================================
-- 4. clear_login_rate_limit() — reset per-(IP,USN) bucket on success
-- ============================================================
-- Called best-effort after a fully verified login so a user's own typos do
-- not linger against their next window. Deletes only the targeted bucket.
create or replace function public.clear_login_rate_limit(p_ip_usn_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_ip_usn_key is null or p_ip_usn_key = '' then
    return;
  end if;
  delete from public.login_rate_buckets where bucket_key = p_ip_usn_key;
end;
$$;

revoke all on function public.clear_login_rate_limit(text) from public;
revoke all on function public.clear_login_rate_limit(text) from anon;
revoke all on function public.clear_login_rate_limit(text) from authenticated;
grant execute on function public.clear_login_rate_limit(text) to service_role;

comment on function public.clear_login_rate_limit(text) is
  'Login abuse protection: clears one per-(IP,USN) bucket after a verified login. Service-role only.';
