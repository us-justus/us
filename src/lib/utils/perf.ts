/**
 * Safe development-only performance instrumentation.
 *
 * Logs operation names + durations only, e.g. `[perf] onboarding.usn 210ms`.
 * Never pass user data, tokens, keys, passwords, USNs, emails, or IDs here —
 * only the static operation label defined at the call site.
 */
export function perfStart(): number {
  return performance.now();
}

/** Log a completed operation. No-op in production. */
export function perfLog(op: string, start: number): void {
  if (process.env.NODE_ENV === "production") return;
  const ms = Math.round(performance.now() - start);
  console.log(`[perf] ${op} ${ms}ms`);
}
