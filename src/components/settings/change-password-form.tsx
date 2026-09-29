"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { validateNewPassword } from "@/lib/auth/account";
import { FieldError } from "@/components/onboarding/shell";

/**
 * Sets (or changes) the password for the CURRENT authenticated user via
 * Supabase Auth. Passwords are never logged and never stored in our database —
 * Supabase Auth is the sole store.
 */
export function ChangePasswordForm({ title = "change password" }: { title?: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setFieldErr(null);
    setDone(false);
    const pErr = validateNewPassword(password);
    if (pErr) {
      setFieldErr(pErr);
      return;
    }
    if (password !== confirm) {
      setFieldErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error("Could not update password. Please try again.");
      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">{title}</h2>
      <div className="mt-3 space-y-4">
        <div>
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">new password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 characters"
            autoComplete="new-password"
            enterKeyHint="next"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        <div>
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">confirm password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="repeat it"
            autoComplete="new-password"
            enterKeyHint="go"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        {fieldErr && <FieldError msg={fieldErr} />}
        {error && (
          <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[13px] text-accent-deep">{error}</p>
          </div>
        )}
        {done && (
          <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[13px] text-accent-deep">password updated.</p>
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex w-full min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy ? "saving…" : "save password"}
        </button>
      </div>
    </div>
  );
}
