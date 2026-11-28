/**
 * Pure response/state mapping for the feedback reply idempotency flow.
 *
 * No I/O or framework imports so the concurrency/failure decisions can be
 * unit-tested without a request context.
 */

export type ClaimFailureReason =
  | "resolved"
  | "already_replied"
  | "in_progress"
  | "error";

export type ClaimFailureResponse = {
  status: 409 | 500;
  error: string;
  reason: ClaimFailureReason;
};

/** Map an unsuccessful admin_claim_feedback_reply() result to HTTP. */
export function claimFailureResponse(reason: unknown): ClaimFailureResponse {
  if (reason === "resolved") {
    return {
      status: 409,
      error: "This feedback is resolved — reply not sent.",
      reason: "resolved",
    };
  }
  if (reason === "already_replied") {
    return {
      status: 409,
      error: "This feedback already has a reply — not sent again.",
      reason: "already_replied",
    };
  }
  if (reason === "in_progress") {
    return {
      status: 409,
      error:
        "A reply is already being processed — check before retrying.",
      reason: "in_progress",
    };
  }
  return {
    status: 500,
    error: "Could not start the reply.",
    reason: "error",
  };
}

export type FeedbackReplyAttemptState =
  | "SENDING"
  | "UNCONFIRMED"
  | "SENT"
  | "RELEASED";

export type FeedbackRecoveryView = {
  state: FeedbackReplyAttemptState | null;
  recoverable: boolean;
};

export function feedbackRecoveryView(
  state: unknown,
): FeedbackRecoveryView | null {
  if (state === null || state === undefined) {
    return { state: null, recoverable: false };
  }
  if (state === "SENDING" || state === "UNCONFIRMED") {
    return { state, recoverable: true };
  }
  if (state === "SENT" || state === "RELEASED") {
    return { state, recoverable: false };
  }
  return null;
}

export type ProviderFailurePlan = {
  settle: "RELEASED" | "UNCONFIRMED";
  status: 502;
  error: string;
  emailSent: false;
  unconfirmed?: true;
};

/**
 * Decide what to do with a claim after a provider failure.
 *
 * Definite failures (missing config, 4xx, 5xx response) release the claim
 * for a safe retry. Ambiguous outcomes (timeout/network) stay UNCONFIRMED:
 * the request may have reached Brevo, so an automatic retry could deliver
 * the same email twice. An admin must verify before recovering.
 */
export function providerFailurePlan(
  result:
    | { kind: "config_error"; detail: string }
    | { kind: "permanent_failure"; detail: string }
    | { kind: "temporary_failure"; detail: string; ambiguous: boolean },
): ProviderFailurePlan {
  if (result.kind === "config_error") {
    return {
      settle: "RELEASED",
      status: 502,
      error: "Email is not configured — reply not sent.",
      emailSent: false,
    };
  }
  if (result.kind === "permanent_failure") {
    return {
      settle: "RELEASED",
      status: 502,
      error: "Could not send the reply. Nothing was recorded — try again.",
      emailSent: false,
    };
  }
  if (result.ambiguous) {
    return {
      settle: "UNCONFIRMED",
      status: 502,
      error:
        "Delivery could not be confirmed — check the provider before retrying.",
      emailSent: false,
      unconfirmed: true,
    };
  }
  return {
    settle: "RELEASED",
    status: 502,
    error: "Could not send the reply. Nothing was recorded — try again.",
    emailSent: false,
  };
}
