"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import { validateNewPassword } from "@/lib/auth/account";
import { FieldError } from "@/components/onboarding/shell";

/**
 * Password reset completion. Reached via a Supabase recovery link routed
 * through /auth/confirm?next=/auth/update-password, which establishes a
 * recovery session. Uses Supabase Auth only — no custom tokens, no storage.
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const { status } = useExistingSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    const pErr = validateNewPassword(password);
    if (pErr) {
      setError(pErr);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error("Could not set password. Your link may have expired.");
      setDone(true);
      setTimeout(() => {
        // /onboarding routes complete profiles to /discover automatically.
        router.push("/onboarding");
        router.refresh();
      }, 900);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not set password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-8 sm:py-10">
        <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">reset password</p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          choose a new one.
        </h1>

        {status === "initializing" ? (
          <p className="mt-8 text-[13px] text-ink-soft">checking your reset link…</p>
        ) : status === "signed-out" ? (
          <div className="mt-8">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-[13px] text-[#a63d2f]">
                This reset link is invalid or expired. Request a fresh one.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
            >
              back to sign in
            </Link>
          </div>
        ) : done ? (
          <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-[13px] text-green-800">password updated — taking you in…</p>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                new password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="at least 8 characters"
                autoComplete="new-password"
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
              />
            </div>
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="repeat it"
                autoComplete="new-password"
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
              />
            </div>
            {error && <FieldError msg={error} />}
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40"
            >
              {busy ? "saving…" : "save new password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
