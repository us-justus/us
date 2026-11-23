/**
 * Pure helpers for the optional moderation action attached to a report
 * resolution (POST /api/inside/reports/resolve).
 *
 * No I/O and no framework imports so the reason/compensation rules can be
 * unit-tested without a request context.
 */

export type ReportModerationMode = "suspend" | "restore";

/** A suspension always needs a reason; compensation must never leave a
 * previously suspended student active because the old reason was missing. */
export const COMPENSATION_FALLBACK_REASON =
  "restored previous suspension (reason unavailable)";

export type ParsedModeration =
  | { ok: true; mode: ReportModerationMode | null }
  | { ok: false; error: string };

/** Parse the optional `moderate` field. Omitted means "resolve only". */
export function parseReportModeration(value: unknown): ParsedModeration {
  if (value === undefined) return { ok: true, mode: null };
  if (value === "suspend" || value === "restore") {
    return { ok: true, mode: value };
  }
  return {
    ok: false,
    error: 'Pass moderate as "suspend" or "restore", or omit it.',
  };
}

/** Keep the audit/DB reason within the shared suspension bound. */
export function cleanSuspensionReason(
  value: unknown,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Arguments for the compensation call after a moderation audit failure.
 *
 * Restoration clears the suspension reason, so undoing a restore requires
 * the PRE-restore reason (never the report's new reason text). Undoing a
 * suspend only needs is_active=true.
 */
export function moderationCompensationArgs(input: {
  previousActive: boolean;
  priorReason: string | null;
  suspendReason: string | null;
}): { p_active: boolean; p_reason?: string } {
  if (input.previousActive) return { p_active: true };
  const reason =
    input.suspendReason ?? input.priorReason ?? COMPENSATION_FALLBACK_REASON;
  return { p_active: false, p_reason: reason };
}
