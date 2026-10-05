/**
 * Feedback constants + pure validation (shared by student + admin routes).
 *
 * Canonical category vocabulary stored in the database (see
 * 20261014000001_feedback_admin_replies.sql): BUG / FEATURE / ACCOUNT /
 * SAFETY / OTHER. The UI shows friendlier labels; the wire + DB values
 * stay canonical. Arbitrary client values are rejected server-side.
 *
 * Pure helpers only — no I/O, no framework imports — so unit tests can
 * import this without a request context.
 */

export const FEEDBACK_CATEGORIES = [
  "BUG",
  "FEATURE",
  "ACCOUNT",
  "SAFETY",
  "OTHER",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  BUG: "something's broken",
  FEATURE: "an idea",
  ACCOUNT: "my account",
  SAFETY: "safety",
  OTHER: "something else",
};

export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_REPLY_MAX = 2000;

/** Max student submissions per user per rolling hour (abuse throttle). */
export const FEEDBACK_SUBMIT_PER_HOUR = 5;

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return (
    typeof value === "string" &&
    (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Validate a student message. Returns the user-facing error, or null. */
export function validateFeedbackMessage(message: unknown): string | null {
  if (typeof message !== "string" || !message.trim()) {
    return "Tell us what's on your mind.";
  }
  if (message.trim().length > FEEDBACK_MESSAGE_MAX) {
    return `Keep it under ${FEEDBACK_MESSAGE_MAX} characters.`;
  }
  return null;
}

/** Validate an admin reply body. Returns the user-facing error, or null. */
export function validateFeedbackReply(reply: unknown): string | null {
  if (typeof reply !== "string" || !reply.trim()) {
    return "Write a reply first.";
  }
  if (reply.trim().length > FEEDBACK_REPLY_MAX) {
    return `Keep the reply under ${FEEDBACK_REPLY_MAX} characters.`;
  }
  return null;
}
