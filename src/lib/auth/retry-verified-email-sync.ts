export async function retryVerifiedEmailSync(options?: {
  attempts?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const requestedAttempts = options?.attempts ?? 3;
  const attempts = Number.isFinite(requestedAttempts)
    ? Math.max(1, Math.min(requestedAttempts, 5))
    : 3;
  const requestedDelay = options?.delayMs ?? 300;
  const delayMs = Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : 300;
  const doFetch = options?.fetchImpl ?? globalThis.fetch;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await doFetch("/api/account/sync-verified-email", { method: "POST" });
      if (res.ok) return true;
    } catch {}
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  return false;
}
