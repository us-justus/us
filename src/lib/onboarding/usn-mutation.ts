/**
 * Pure USN-submission rules for `POST /api/onboarding/usn`.
 *
 * Extracted so the exact failure's contract is unit-tested:
 * - same-UID retry with the same USN is idempotent (`ok`), even after the
 *   profile exists — a returning user re-submitting their own USN never sees
 *   "already associated";
 * - a duplicate-USN conflict (`23505`) only arises when a DIFFERENT UID
 *   attempts to claim an already-owned USN, i.e. a UID mismatch, never a
 *   validation failure on the correct account.
 *
 * No I/O, no imports — unit-testable under plain `node --test`.
 */

export type UsnMutationDecision =
  | { action: "ok-idempotent" }
  | { action: "reject-immutable" }
  | { action: "upsert" };

export function decideUsnMutation(args: {
  hasProfile: boolean;
  /** Stored USN for the CALLER's UID (normalized, "" when none). */
  storedUsn: string;
  /** Submitted USN (normalized). */
  submittedUsn: string;
}): UsnMutationDecision {
  if (!args.hasProfile) return { action: "upsert" };
  if (args.storedUsn && args.storedUsn === args.submittedUsn) {
    return { action: "ok-idempotent" };
  }
  return { action: "reject-immutable" };
}

export function isDuplicateUsnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (typeof error.code === "string" && error.code === "23505") return true;
  const msg = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return msg.includes("duplicate");
}
