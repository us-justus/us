"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export default function USNPage() {
  const router = useRouter();
  const [usn, setUsn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ensureSession() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error("Could not start session. Try again.");
    }
  }

  async function submit() {
    setError(null);
    const normalized = normalizeUSN(usn);
    if (!validateUSN(normalized)) { setError("Enter a valid USN."); return; }
    setLoading(true);
    try {
      await ensureSession();
      const res = await fetch("/api/onboarding/usn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usn: normalized }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      router.push("/onboarding/email");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again.";
      if (msg.includes("already")) setError("This USN is already associated with an account.");
      else setError(msg);
    } finally { setLoading(false); }
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
