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

/** Log a completed operation; production logs only slow, static-label timings. */
export function perfLog(op: string, start: number): void {
  try {
    const ms = Math.round(performance.now() - start);
    if (process.env.NODE_ENV === "production") {
      // Existing call sites pass static operation labels. Keep production
      // volume low and avoid logging arbitrary caller-provided values.
      if (ms < 1_000 || !/^[a-z0-9.-]{1,80}$/i.test(op)) return;
      console.info("[perf]", JSON.stringify({ op, duration_ms: ms }));
      return;
    }
    console.log(`[perf] ${op} ${ms}ms`);
  } catch {
    // Observability must never affect request handling.
  }
}
