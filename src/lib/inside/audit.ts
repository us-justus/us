import { createHash } from "node:crypto";
import { normalizeAdminLoginIdentity } from "@/lib/auth/login-rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "./auth";

/**
 * INSIDE Step 2 — the single server-only admin audit implementation.
 *
 * NEVER import this module from client components. It is server-only by
 * construction: it reads SUPABASE_SERVICE_ROLE_KEY (via
 * createServiceRoleClient) and derives actors from the authenticated admin
 * context. No function here accepts an actor supplied by the browser.
 *
 * WRITE PATH: direct insert into public.inside_audit_events through the
 * server-only service-role client. The table has RLS enabled with NO
 * policies and NO grants to anon/authenticated, so the browser cannot
 * INSERT / UPDATE / DELETE (or even SELECT); service_role bypasses RLS and
 * is the sole writer. Immutability comes from the absence of any
 * UPDATE/DELETE path, not from application discipline.
 *
 * ACTOR RULES:
 *   - Authenticated paths (logout, launch) derive the actor from
 *     requireInsideAdmin() — the Step 1 gate (signed cookie + live session
 *     for the same user + current admin_users membership). A caller that
 *     fails the gate cannot write an attributed event.
 *   - Login success derives the actor from the just-verified session user
 *     (requireInsideAdmin() cannot run yet: the cookie is minted on the
 *     outgoing response). Membership is re-checked server-side against
 *     admin_users before writing, so a non-admin can never gain an
 *     ADMIN_LOGIN_SUCCESS row even if a caller misuses this helper.
 *   - Login failure has no authenticated session by definition: the actor
 *     is NULL and only a sha256 of the normalized identifier is kept (the
 *     same hash-only privacy approach as the login-abuse buckets). Raw
 *     identifiers, passwords, keys, and tokens are never stored.
 *
 * AUDIT FAILURE BEHAVIOR (deliberate, per call site):
 *   - Launch mutations (privileged state change): FAIL CLOSED. The route
 *     snapshots state before mutating; if the mutation succeeds but the
 *     audit insert fails, the route restores the snapshot (best-effort
 *     compensation) and returns 500 instead of success, so we never end up
 *     with "launch changed + no audit record" reported as success. Audit
 *     errors are logged server-side with no secrets or identifiers.
 *   - Login success/failure and logout: BEST-EFFORT. An audit-storage
 *     outage must not change authentication outcomes: failures still
 *     return the generic 401, successes still return the session, logout
 *     still clears the cookie. Failing auth closed on an audit outage
 *     would either lock admins out (availability) or — worse, if handled
 *     carelessly — risk an auth bypass or credential exposure. The gap is
 *     covered by server-side error logs plus the independent login
 *     rate-limit buckets, which keep working regardless.
 */

export const INSIDE_AUDIT_ACTIONS = [
  "ADMIN_LOGIN_SUCCESS",
  "ADMIN_LOGIN_FAILURE",
  "ADMIN_LOGOUT",
  "LAUNCH_ENABLED",
  "LAUNCH_DISABLED",
  "LAUNCH_VERSION_CHANGED",
] as const;

export type InsideAuditAction = (typeof INSIDE_AUDIT_ACTIONS)[number];

/** JSON-safe metadata. Callers must never put secrets here (see above). */
export type InsideAuditMetadata = Record<string, string | boolean | number | null>;

export type InsideAuditResult = { ok: true } | { ok: false; error: string };

/**
 * Hash an /inside/login identifier for audit attribution. Reuses the
 * login-abuse normalization (email lowercased, USN canonicalized, phone to
 * digits) so one identity maps to one digest; only the hex digest persists.
 */
export function hashAdminLoginIdentity(idRaw: string): string {
  return createHash("sha256")
    .update(normalizeAdminLoginIdentity(idRaw), "utf8")
    .digest("hex");
}

/**
 * The single row writer. Not exported — all writes flow through the
 * attributed wrappers below, which is what keeps arbitrary actors out.
 */
async function insertAuditEvent(row: {
  actorUserId: string | null;
  action: InsideAuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: InsideAuditMetadata | null;
}): Promise<InsideAuditResult> {
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    console.error("[inside] audit unavailable: service-role misconfigured");
    return { ok: false, error: "audit unavailable" };
  }
  try {
    const { error } = await service.from("inside_audit_events").insert({
      actor_user_id: row.actorUserId,
      action: row.action,
      target_type: row.targetType ?? null,
      target_id: row.targetId ?? null,
      metadata: row.metadata ?? null,
    });
    if (error) {
      console.error("[inside] audit insert failed");
      return { ok: false, error: "audit insert failed" };
    }
    return { ok: true };
  } catch {
    console.error("[inside] audit insert failed");
    return { ok: false, error: "audit insert failed" };
  }
}

/**
 * Attributed event for callers holding a verified /inside session
 * (logout, launch). The actor comes from requireInsideAdmin(), never from
 * arguments — there is no parameter through which a client could supply
 * or override it.
 */
export async function recordInsideAuditEvent(
  action: InsideAuditAction,
  opts?: {
    targetType?: string;
    targetId?: string;
    metadata?: InsideAuditMetadata;
  },
): Promise<InsideAuditResult> {
  const gate = await requireInsideAdmin();
  if (!gate) return { ok: false, error: "not authorized" };
  return insertAuditEvent({
    actorUserId: gate.userId,
    action,
    targetType: opts?.targetType ?? null,
    targetId: opts?.targetId ?? null,
    metadata: opts?.metadata ?? null,
  });
}

/**
 * ADMIN_LOGIN_SUCCESS for the just-verified login session. The user id is
 * the server-derived session user (never client input); admin membership
 * is re-checked here via the privileged client, so misuse with a
 * non-admin id cannot fabricate a success event.
 */
export async function recordInsideLoginSuccess(
  userId: string,
): Promise<InsideAuditResult> {
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    console.error("[inside] audit unavailable: service-role misconfigured");
    return { ok: false, error: "audit unavailable" };
  }
  try {
    const { data, error } = await service
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "not authorized" };
  } catch {
    return { ok: false, error: "audit unavailable" };
  }
  return insertAuditEvent({
    actorUserId: userId,
    action: "ADMIN_LOGIN_SUCCESS",
  });
}

/**
 * ADMIN_LOGIN_FAILURE. No actor (no session exists); attribution is the
 * hashed identifier only. Callers pass the PRE-HASHED digest, so raw
 * identifiers never even reach this module's boundary from most call
 * sites — and this function never sees passwords, keys, or tokens.
 */
export async function recordInsideLoginFailure(
  identityHash: string,
): Promise<InsideAuditResult> {
  return insertAuditEvent({
    actorUserId: null,
    action: "ADMIN_LOGIN_FAILURE",
    metadata: { identity_hash: identityHash },
  });
}
