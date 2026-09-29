"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export default function USNPage() {
  const router = useRouter();
  const [usn, setUsn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Shared bootstrap: restores the existing anonymous session, signs in only
  // when none exists. `ensureAnonymousSession()` remains the single place
  // that may establish a session.
  const { status: sessionStatus, retry: retrySession } = useAnonymousSession();

  async function submit() {
    if (sessionStatus !== "ready") return;
    setError(null);
    const normalized = normalizeUSN(usn);
    if (!validateUSN(normalized)) {
      setError("Enter a valid USN.");
      return;
    }
    setLoading(true);
    try {
      // No ensureAnonymousSession() here: the hook above already bootstrapped
      // the session before enabling submit. Re-validating would add an extra
      // auth round-trip to the critical path; the API 401s safely if the
      // session is ever missing.
      const res = await fetch("/api/onboarding/usn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usn: normalized }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      router.push("/onboarding/email");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again.";
      if (process.env.NODE_ENV !== "production") console.error("[usn] submit error", e);
      if (msg.toLowerCase().includes("already") || msg.includes("duplicate")) setError("This USN is already associated with an account.");
      else if (msg.toLowerCase().includes("anonymous")) setError("We couldn't start your session. Please try again.");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const isContinueDisabled = loading || sessionStatus !== "ready";

  return (
    <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
      <div className="space-y-5">
        <div>
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">USN</label>
          <input
            value={usn}
            onChange={(e) => setUsn(e.target.value)}
            placeholder="e.g. 1AY22CS001"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base uppercase tracking-[0.08em] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          {error && <FieldError msg={error} />}
        </div>
        <Button onClick={submit} disabled={isContinueDisabled} className="w-full rounded-full">
          {loading ? "verifying…" : "continue"}
        </Button>
        {sessionStatus === "initializing" && <p className="text-[12px] text-ink-faint">preparing your session…</p>}
        {sessionStatus === "error" && (
          <div className="space-y-3">
            <FieldError msg="We couldn't start your session. Please try again." />
            <Button onClick={retrySession} className="w-full rounded-full">
              Try again
            </Button>
          </div>
        )}
        <p className="text-[11px] leading-4 text-ink-faint">We only use this to confirm you&apos;re on campus. Never displayed publicly.</p>
      </div>
    </Shell>
  );
}
