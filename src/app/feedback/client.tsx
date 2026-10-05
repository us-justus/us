"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/onboarding/shell";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackCategory,
} from "@/lib/feedback/constants";

type OwnRow = {
  id: string;
  category: string;
  message: string;
  status: string;
  created_at: string;
};

const SENT = "Thanks — we read everything.";

export function FeedbackClient() {
  const { status } = useExistingSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Appeal entry (?appeal=1 from /suspended): the ACCOUNT category is
  // pre-selected and the form explains the context. The server still
  // derives the suspension link itself — this is presentation only.
  const isAppeal = searchParams.get("appeal") === "1";
  const [category, setCategory] = useState<FeedbackCategory>(
    isAppeal ? "ACCOUNT" : "BUG",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<OwnRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    if (status === "signed-out") {
      router.replace("/login");
    }
  }, [status, router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/feedback", { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((j) => {
        if (!cancelled && j && Array.isArray(j.feedback)) {
          setHistory(j.feedback as OwnRow[]);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!message.trim()) {
      setError("Tell us what's on your mind.");
      return;
    }
    if (message.trim().length > FEEDBACK_MESSAGE_MAX) {
      setError(`Keep it under ${FEEDBACK_MESSAGE_MAX} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: message.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof j?.error === "string" ? j.error : "Could not send feedback. Try again.",
        );
      }
      setMessage("");
      setNotice(SENT);
      const row = await fetch("/api/feedback", { cache: "no-store" })
        .then((r) => r.json().catch(() => null))
        .catch(() => null);
      if (row && Array.isArray(row.feedback)) setHistory(row.feedback as OwnRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send feedback. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          talk to us
        </p>
        <h1 className="mt-2 font-display text-[30px] leading-none tracking-[-0.03em] sm:text-[34px]">
          feedback.
        </h1>
        <p className="mt-3 max-w-[38ch] text-[13px] leading-6 text-ink-soft">
          {isAppeal
            ? "your account is suspended — tell us what happened and we'll take another look."
            : "found a bug, want something, or just want to talk — we read everything."}
        </p>

        {isAppeal && (
          <div className="mt-5 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[13px] text-accent-deep">
              This goes to the team as an appeal — no need to explain which account, we
              already know it&apos;s yours.
            </p>
          </div>
        )}

        <form onSubmit={(e) => void submit(e)} className="mt-8">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            what&apos;s this about
          </p>
          <div
            role="group"
            aria-label="feedback category"
            className="mt-3 flex flex-wrap gap-2"
          >
            {FEEDBACK_CATEGORIES.map((c) => {
              const selected = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategory(c)}
                  className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                    selected
                      ? "border-accent-soft bg-accent-wash text-accent-deep"
                      : "border-line text-ink-soft hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep"
                  }`}
                >
                  {FEEDBACK_CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <label
              htmlFor="feedback-message"
              className="text-[11px] uppercase tracking-[0.14em] text-ink-faint"
            >
              message
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={FEEDBACK_MESSAGE_MAX + 20}
              enterKeyHint="send"
              placeholder="tell us what happened…"
              className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {message.trim().length}/{FEEDBACK_MESSAGE_MAX}
            </p>
          </div>

          {error && <FieldError msg={error} />}
          {notice && (
            <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] text-ink">{notice}</p>
            </div>
          )}

          <Button type="submit" disabled={busy} className="mt-5 w-full">
            {busy ? "sending…" : "send"}
          </Button>
        </form>

        <section aria-label="my feedback" className="mt-10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            my feedback
          </p>
          <div className="mt-3">
            {historyLoading ? (
              <p className="text-[12px] leading-5 text-ink-faint">loading…</p>
            ) : history.length === 0 ? (
              <p className="text-[12px] leading-5 text-ink-faint">
                nothing yet — your notes will land here.
              </p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {history.map((f) => (
                  <li key={f.id} className="py-3">
                    <p className="text-[13px] text-ink">
                      {f.category}
                      <span className="text-ink-faint">
                        {" "}· {f.status === "RESOLVED" ? "resolved" : "open"}
                      </span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-ink-soft">
                      {f.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
