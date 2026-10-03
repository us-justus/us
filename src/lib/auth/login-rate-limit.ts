import { createHash } from "node:crypto";

/**
 * Login rate-limit helpers (STEP 3 — login abuse protection).
 *
 * KEY DIMENSIONS (no device fingerprinting, no global per-USN lockout):
 *   - `ip:<sha256(ip)>` — tolerant campus/NAT-shared bucket.
 *   - `ip-usn:<sha256(ip + "\n" + normalizedUsn)>` — targeted per-account
 *     bucket. An attacker rotating USNs still fills the IP bucket; an
 *     attacker rotating source keys still faces the per-target bound per
 *     key. A global per-USN lockout is deliberately NOT implemented so one
 *     source cannot lock another student's account.
 *
 * THRESHOLDS (provisional implementation constants — easy to tune, NOT
 * security guarantees; authoritative values live in the
 * check_login_rate_limit() migration):
 *   - LOGIN_RATE_LIMIT_WINDOW_SECONDS = 900 (15 min fixed window)
 *   - LOGIN_RATE_LIMIT_MAX_PER_IP = 100 (substantially tolerant)
 *   - LOGIN_RATE_LIMIT_MAX_PER_IP_USN = 10 (targeted)
 *
 * IP TRUST MODEL: the repo declares no hosting platform, so there is no
 * trustworthy proxy-provided source IP yet. getClientIp() prefers the first
 * entry of `x-forwarded-for`, then `x-real-ip`, else "unknown" (all unknown
 * sources share one conservative bucket). Under the current runtime that
 * header is client-influenceable — the implementation does NOT pretend it is
 * authoritative. Follow-up once hosting is declared: bind extraction to the
 * platform-verified connecting-IP header / proxy allowlist and re-tune.
 */

export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 900;
export const LOGIN_RATE_LIMIT_MAX_PER_IP = 100;
export const LOGIN_RATE_LIMIT_MAX_PER_IP_USN = 10;

export const LOGIN_THROTTLED_MESSAGE = "Too many login attempts. Please try again later.";

/** Best-effort client IP under the current runtime (see trust model above). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim().slice(0, 128);
  return "unknown";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash-only keys: raw IP/USN never leave this process toward storage. */
export function loginRateLimitKeys(ip: string, normalizedUsn: string) {
  return {
    ipKey: `ip:${sha256Hex(ip)}`,
    ipUsnKey: `ip-usn:${sha256Hex(`${ip}\n${normalizedUsn}`)}`,
  };
}

export type LoginRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };
