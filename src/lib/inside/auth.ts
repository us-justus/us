import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  INSIDE_COOKIE,
  INSIDE_SESSION_TTL_MS,
  clearInsideCookieHeader,
  cookieAttrs,
  setInsideCookieHeader,
} from "./cookie";

// Re-exported so existing import sites (`/api/inside/*`) keep working.
export { INSIDE_COOKIE, clearInsideCookieHeader, cookieAttrs, setInsideCookieHeader };

/**
 * INSIDE v1 — server-only admin session helpers.
 *
 * NEVER import this module from client components. It touches
 * ADMIN_SECRET_KEY, which must never enter the frontend bundle.
 *
 * Session model (both factors bound together server-side):
 *   1. Supabase Auth session (email/USN/phone + password sign-in).
 *   2. admin_users membership (explicit authorization, checked via the
 *      is_admin() RPC on every verification).
 *   After both verify, the server mints a signed `inside_admin` httpOnly
 *   cookie: "<userId>.<exp>.<sig>" where
 *   sig = HMAC-SHA256("<userId>.<exp>", ADMIN_SECRET_KEY).
 *
 * The cookie proves THIS login ceremony passed the admin gate, so a
 * session minted via the normal /login can never open /inside even
 * for an admin user. ADMIN_SECRET_KEY is strictly server-side: it only
 * signs the cookie and is never accepted from, nor sent to, clients.
 * The secret itself is never stored, logged, returned, or sent to clients.
 */

function secret(): string | null {
  const s = process.env.ADMIN_SECRET_KEY;
  return s && s.length >= 16 ? s : null;
}

export function isInsideConfigured(): boolean {
  return secret() !== null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(userId: string, exp: number): string {
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", secret()!).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Mint the cookie value after all three login factors verified. */
export function mintInsideSession(userId: string): string {
  return sign(userId, Date.now() + INSIDE_SESSION_TTL_MS);
}

function parseSession(
  value: string,
): { userId: string; exp: number; sig: string } | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!userId || !Number.isFinite(exp) || !sig) return null;
  return { userId, exp, sig };
}

/**
 * Verify the /inside gate: signed cookie + live Supabase session for the
 * SAME user + current admin_users membership. Returns the user id or null.
 * Generic by design — callers must not distinguish the failure reasons.
 */
export async function requireInsideAdmin(): Promise<{ userId: string } | null> {
  if (!secret()) return null;
  const store = await cookies();
  const raw = store.get(INSIDE_COOKIE)?.value;
  if (!raw) return null;
  const parsed = parseSession(raw);
  if (!parsed || parsed.exp < Date.now()) return null;
  const expected = sign(parsed.userId, parsed.exp);
  if (!safeEqual(raw, expected)) return null;

  const supabase = await createClient();
  const { data: revoked, error: revokedError } = await supabase.rpc(
    "is_inside_session_revoked",
    { p_token: raw },
  );
  if (revokedError || revoked === true) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== parsed.userId) return null;

  // Reuse the authenticated user — is_admin() reads auth.uid() server-side,
  // so no second getUser() and no user id is ever trusted from the client.
  const { data: admin, error } = await supabase.rpc("is_admin");
  if (error || admin !== true) return null;
  return { userId: user.id };
}
