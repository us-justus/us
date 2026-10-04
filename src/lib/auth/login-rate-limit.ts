import { createHash } from "node:crypto";
import { normalizeUSN, validateUSN } from "../verification/usn.ts";

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

/**
 * INSIDE admin-login key dimensions (Step 1 hardening).
 *
 * Reuses the SAME `check_login_rate_limit()` / `clear_login_rate_limit()`
 * RPCs and the SAME hashing construction — this is not a second limiter
 * implementation. Only the key PREFIXES differ (`admin-ip:` /
 * `admin-ip-id:` instead of `ip:` / `ip-usn:`) so admin-login attempts and
 * student-login attempts never share a bucket: a student-login flood behind
 * campus NAT cannot throttle admin login and admin key-guessing cannot
 * throttle students. Thresholds/window/fail-open semantics are the
 * authoritative ones inside the DB function, shared by both callers.
 */
export function adminLoginRateLimitKeys(ip: string, normalizedIdentity: string) {
  return {
    ipKey: `admin-ip:${sha256Hex(ip)}`,
    ipIdKey: `admin-ip-id:${sha256Hex(`${ip}\n${normalizedIdentity}`)}`,
  };
}

/**
 * Normalize an `/api/inside/login` identifier for rate-limit bucketing ONLY.
 * Mirrors the route's email/USN/phone split so one identity maps to one
 * bucket regardless of trivial re-formatting (case, surrounding spaces).
 * The output is hashed before storage; raw identifiers never persist.
 */
export function normalizeAdminLoginIdentity(idRaw: string): string {
  const t = idRaw.trim();
  if (t.includes("@")) return t.toLowerCase();
  const asUsn = normalizeUSN(t);
  if (validateUSN(asUsn)) return asUsn;
  const digits = t.replace(/\D/g, "");
  if (digits) return digits;
  return t.toLowerCase();
}

export type LoginRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };
