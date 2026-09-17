"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession } from "@/lib/auth/session";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export default function USNPage() {
  const router = useRouter();
  const [usn, setUsn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"initializing" | "ready" | "error">("initializing");

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      setSessionStatus("initializing");
      const result = await ensureAnonymousSession();
      if (cancelled) return;
      if (result.error || !result.session) {
        if (process.env.NODE_ENV !== "production") console.error("[usn] session init failed", result.error);
        setSessionStatus("error");
        return;
      }
      setSessionStatus("ready");
    }
    initialize();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const { error: sessErr, session } = await ensureAnonymousSession();
      if (sessErr || !session) throw new Error(sessErr || "We couldn't start your session. Please try again.");
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

  async function retrySession() {
    setSessionStatus("initializing");
    const result = await ensureAnonymousSession();
    if (result.error || !result.session) {
      if (process.env.NODE_ENV !== "production") console.error("[usn] retry failed", result.error);
      setSessionStatus("error");
    } else {
      setSessionStatus("ready");
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
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] uppercase tracking-[0.08em] outline-none focus:border-ink-faint"
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
