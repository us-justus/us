/**
 * Suspension constants + pure validation (shared by moderation + appeal flows).
 *
 * The current suspension state lives on profiles
 * (suspension_reason / suspended_at / suspended_by, see
 * 20261015000001_suspension_reasons_appeals.sql). History lives in
 * inside_audit_events (STUDENT_SUSPENDED / STUDENT_RESTORED) — never in
 * profiles.
 *
 * Pure helpers only — no I/O, no framework imports — so unit tests can
 * import this without a request context.
 */

/** Admin-provided suspension reasons are capped at 280 chars (DB CHECK). */
export const SUSPENSION_REASON_MAX = 280;

/** Validate an admin-supplied suspension reason. Returns the error, or null. */
export function validateSuspensionReason(reason: unknown): string | null {
  if (typeof reason !== "string" || !reason.trim()) {
    return "Tell the student why they're suspended.";
  }
  if (reason.trim().length > SUSPENSION_REASON_MAX) {
    return `Keep the reason under ${SUSPENSION_REASON_MAX} characters.`;
  }
  return null;
}

export type SuspensionState = {
  suspended: boolean;
  /** Present only for the suspended user themselves / admins. Never public. */
  reason: string | null;
  suspendedAt: string | null;
};
