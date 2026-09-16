"use client";
import { useEffect, useState, useRef } from "react";
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
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cancelled = false;
    (async () => {
      const { error: err } = await ensureAnonymousSession();
      if (cancelled) return;
      if (err) {
        if (process.env.NODE_ENV !== "production") console.error("[usn] session init failed", err);
        setSessionError("We couldn't start your session. Please try again.");
      } else {
        setSessionReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    setError(null);
    const normalized = normalizeUSN(usn);
    if (!validateUSN(normalized)) { setError("Enter a valid USN."); return; }
    setLoading(true);
    try {
      const { error: sessErr } = await ensureAnonymousSession();
      if (sessErr) throw new Error(sessErr);
      const res = await fetch("/api/onboarding/usn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usn: normalized }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      router.push("/onboarding/email");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again.";
      if (process.env.NODE_ENV !== "production") console.error("[usn] submit error", e);
      if (msg.toLowerCase().includes("already") || msg.includes("duplicate")) setError("This USN is already associated with an account.");
      else if (msg.toLowerCase().includes("anonymous")) setError("We couldn't start your session. Please try again.");
      else setError(msg);
    } finally { setLoading(false); }
  }

  async function retrySession() {
    setSessionError(null);
    const { error: err } = await ensureAnonymousSession();
    if (err) {
      if (process.env.NODE_ENV !== "production") console.error("[usn] retry failed", err);
      setSessionError("We couldn't start your session. Please try again.");
    } else {
      setSessionReady(true);
    }
  }

  if (sessionError) {
    return (
      <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
        <div className="space-y-4">
          <FieldError msg={sessionError} />
          <Button onClick={retrySession} className="w-full rounded-full">Try again</Button>
        </div>
      </Shell>
    );
  }

  if (!sessionReady) {
    return (
      <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
        <p className="text-[13px] text-ink-soft">Starting your session…</p>
      </Shell>
    );
  }

  return (
    <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
      <div className="space-y-5">
        <div>
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">USN</label>
          <input value={usn} onChange={e => setUsn(e.target.value)} placeholder="e.g. 1AY22CS001" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] uppercase tracking-[0.08em] outline-none focus:border-ink-faint" />
          {error && <FieldError msg={error} />}
        </div>
        <Button onClick={submit} disabled={loading} className="w-full rounded-full">{loading ? "verifying…" : "continue"}</Button>
        <p className="text-[11px] leading-4 text-ink-faint">We only use this to confirm you&apos;re on campus. Never displayed publicly.</p>
      </div>
    </Shell>
  );
}
