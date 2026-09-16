"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateOptionalEmail } from "@/lib/validation/email";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export default function EmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(skip = false) {
    const val = skip ? "" : email.trim();
    const err = validateOptionalEmail(val);
    if (err) { setError(err); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: val || null }) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      router.push("/onboarding/profile");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Try again."); } finally { setLoading(false); }
  }

  return (
    <Shell title="student email — optional." subtitle="Add it if you'd like. We keep it private." step="02 — email">
      <div className="space-y-5">
        <div>
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">campus email <span className="lowercase tracking-normal normal-case text-ink-faint">— optional</span></label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@campus.edu" inputMode="email" autoComplete="email"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint" />
          {error && <FieldError msg={error} />}
        </div>
        <Button onClick={() => submit(false)} disabled={loading} className="w-full rounded-full">{loading ? "saving…" : "continue"}</Button>
        <button onClick={() => submit(true)} disabled={loading} className="w-full text-[12px] tracking-[0.12em] uppercase text-ink-soft hover:text-ink py-2">skip for now</button>
      </div>
    </Shell>
  );
}
