"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/onboarding/shell";
import { getQueueSendState } from "@/lib/inside/email-queue-send-state";

type DashboardInitial = {
  waiting: number;
  suspended: number;
  countsLive: boolean;
};

const LOGIN_ERROR = "Those details don't open inside.";

export function InsideClient(
  props: { mode: "login" } | { mode: "dashboard"; initial: DashboardInitial },
) {
  if (props.mode === "login") return <InsideLogin />;
  return <InsideDashboard initial={props.initial} />;
}

/* ---------------- login ---------------- */

function InsideLogin() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enter() {
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your identifier and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/inside/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      if (!res.ok) throw new Error(LOGIN_ERROR);
      // The server gate re-runs with the fresh signed cookie.
      window.location.reload();
    } catch {
      setError(LOGIN_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        internal
      </p>
      <h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.03em] sm:text-[40px]">
        inside.
      </h1>
      <p className="mt-3 max-w-[38ch] text-[13px] leading-6 text-ink-soft">
        the part of us you don&apos;t see.
      </p>

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          void enter();
        }}
      >
        <div>
          <label
            htmlFor="inside-id"
            className="text-[11px] uppercase tracking-[0.14em] text-ink-faint"
          >
            identifier
          </label>
          <input
            id="inside-id"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="email / phone / USN"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            enterKeyHint="next"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor="inside-password"
            className="text-[11px] uppercase tracking-[0.14em] text-ink-faint"
          >
            password
          </label>
          <div className="relative mt-2">
            <input
              id="inside-password"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              enterKeyHint="go"
              className="w-full rounded-2xl border border-line bg-paper px-4 py-3.5 pr-16 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "hide password" : "show password"}
              className="absolute right-2 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full text-[12px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep"
            >
              {showPw ? "hide" : "show"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[13px] text-accent-deep">{error}</p>
          </div>
        )}

        <Button type="submit" disabled={busy} className="mt-5 w-full">
          {busy ? "checking…" : "enter"}
        </Button>
      </form>
    </div>
  );
}

/* ---------------- dashboard ---------------- */

function InsideDashboard({ initial }: { initial: DashboardInitial }) {
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    try {
      await fetch("/api/inside/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        internal
      </p>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] leading-none tracking-[-0.03em] sm:text-[40px]">
            inside.
          </h1>
          <p className="mt-3 max-w-[38ch] text-[13px] leading-6 text-ink-soft">
            the part of us you don&apos;t see.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void leave()}
          disabled={leaving}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
        >
          {leaving ? "leaving…" : "leave"}
        </button>
      </div>

      {/* waitlist overview: active photo-complete profiles vs suspended */}
      <section aria-label="campus overview" className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">waiting</p>
          <p className="mt-2 font-display text-[32px] leading-none tracking-[-0.02em]">
            {initial.countsLive ? initial.waiting.toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">suspended</p>
          <p className="mt-2 font-display text-[32px] leading-none tracking-[-0.02em]">
            {initial.countsLive ? initial.suspended.toLocaleString() : "—"}
          </p>
        </div>
      </section>
      {!initial.countsLive && (
        <p className="mt-3 text-[12px] leading-5 text-ink-faint">
          counts unavailable — the database may predate the inside migration.
        </p>
      )}

      <StudentsPanel />
      <FeedbackPanel />
      <EmailQueuePanel />
      <ReportsPanel />
      <HealthPanel />
    </div>
  );
}

/* ---------------- waitlist email queue (preparation only) ---------------- */

type EmailQueueSummary = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  skippedCount: number;
  students: EmailAudienceStudent[];
  pending: number;
  sent: number;
  failed: number;
  sending?: number;
  skippedQueue?: number;
  lastPreparedAt: string | null;
};

type EmailAudienceStudent = {
  username: string | null;
  nickname: string | null;
  usn: string | null;
  spot: number | null;
  email: string;
};

type EmailQueuePreparation = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  addedCount: number;
  alreadyPreparedCount: number;
  skippedCount: number;
  students: EmailAudienceStudent[];
  recipients: string[];
};

type EmailQueueSendResult = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  unrecorded: number;
  remaining: number;
};

function formatQueueTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmailQueuePanel() {
  const [summary, setSummary] = useState<EmailQueueSummary | null>(null);
  const [preparation, setPreparation] = useState<EmailQueuePreparation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendConfirming, setSendConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<EmailQueueSendResult | null>(null);
  const [draftSubject, setDraftSubject] = useState("us waitlist update");
  const [draftBody, setDraftBody] = useState(
    "Hi there,\n\nThanks for being part of us. We’ll be in touch soon.\n\n— us",
  );

  async function loadSummary() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inside/email-queue", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string"
            ? json.error
            : "Could not load the email queue.",
        );
      }
      setSummary(json as unknown as EmailQueueSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the email queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inside/email-queue", { cache: "no-store" })
      .then((res) => res.json().then((json: unknown) => ({ ok: res.ok, json: json as { error?: unknown } | null })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          throw new Error(
            typeof json?.error === "string"
              ? json.error
              : "Could not load the email queue.",
          );
        }
        setSummary(json as unknown as EmailQueueSummary);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load the email queue.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function prepareQueue() {
    setPreparing(true);
    setError(null);
    setPreparation(null);
    setSendResult(null);
    setSendConfirming(false);
    try {
      const res = await fetch("/api/inside/email-queue", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string"
            ? json.error
            : "Could not prepare the email queue.",
        );
      }
       const prepared = {
         ...(json as unknown as Omit<EmailQueuePreparation, "students" | "recipients">),
         students: [],
         recipients: [],
       } as EmailQueuePreparation;
      setPreparation(prepared);
      setSummary((current) =>
        current
          ? {
              ...current,
              waitingStudentCount: prepared.waitingStudentCount,
              uniqueRecipientCount: prepared.uniqueRecipientCount,
              skippedCount: prepared.skippedCount,
               students: [],
            }
          : current,
      );
      setConfirming(false);
      await loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the email queue.");
    } finally {
      setPreparing(false);
    }
  }

  async function sendQueue() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/inside/email-queue/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: draftSubject, message: draftBody }),
      });
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string"
            ? json.error
            : "Could not send the email.",
        );
      }
      const result = json as unknown as EmailQueueSendResult;
      setSendResult({
        attempted: result.attempted,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        unrecorded: result.unrecorded,
        remaining: result.remaining,
      });
      setSendConfirming(false);
      await loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the email.");
    } finally {
      setSending(false);
    }
  }

  // Persisted send availability — the ONLY source of truth for whether
  // a send action may be offered. `summary` comes from the server queue
  // snapshot and survives refresh; local `preparation`/`sendResult` do not.
  // remaining = PENDING + SENDING (mirrors the send route); SENT rows are
  // never candidates and SKIPPED/permanent FAILED rows are terminal.
  const queueSendState = getQueueSendState(summary, { isSending: sending });
  // Visibility of the refresh-safe persisted block must not flicker away
  // mid-send: derive it without the transient in-flight flag.
  const queueBaseState = getQueueSendState(summary);
  const persistedShowSent = queueBaseState === "sent";
  const persistedShowRetry = queueBaseState === "retry";
  const queuePending = summary?.pending ?? 0;
  const queueSendingCount = summary?.sending ?? 0;
  const queueSent = summary?.sent ?? 0;
  const queueFailed = summary?.failed ?? 0;
  const queueSkipped = summary?.skippedQueue ?? 0;
  const queueRemaining = queuePending + queueSendingCount;
  const queueFullySent = queueSendState === "sent";
  const queueNeedsRetry = queueSendState === "retry";
  // The prepared-email form becomes historical once everything eligible
  // is durably sent: keep subject/message visible for reference but stop
  // them implying a further send is possible.
  const sendFormLocked = sending || (summary !== null && queueFullySent);

  const counts: Array<[string, number | undefined]> = [
    ["unique recipients", summary?.uniqueRecipientCount],
    ["pending", summary?.pending],
    ["sent", summary?.sent],
    ["failed", summary?.failed],
  ];

  const waitingLabel =
    summary === null
      ? "loading…"
      : `${summary.waitingStudentCount.toLocaleString()} ${summary.waitingStudentCount === 1 ? "student waiting" : "students waiting"}`;

  return (
    <section
      aria-label="email queue"
      className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">email</p>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading || preparing}
          className="inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
        >
          {loading ? "loading…" : "refresh"}
        </button>
      </div>

      <p className="mt-4 font-display text-[32px] leading-none tracking-[-0.03em]">
        {waitingLabel}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-ink-soft">
        These students have completed their profile and provided a valid email address.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="subtle"
          onClick={() => setStudentsOpen((v) => !v)}
          disabled={loading}
        >
          {studentsOpen ? "hide students" : "view students"}
        </Button>
      </div>

      {studentsOpen && (
        <div className="mt-4 rounded-2xl border border-line bg-paper px-4 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            waiting students
          </p>
          {summary?.students.length === 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-faint">
              No students are currently waiting.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {(summary?.students ?? []).map((student, index) => (
                <li
                  key={student.usn ?? student.username ?? `${student.email}-${index}`}
                  className="rounded-2xl border border-line bg-paper-2 px-3 py-3"
                >
                  <p className="text-[13px] text-ink">
                    {student.username ? `@${student.username}` : student.nickname ?? "student"}
                    {typeof student.spot === "number" ? (
                      <span className="text-ink-faint"> #{student.spot}</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                    {student.nickname && student.username ? student.nickname : ""}
                    {student.usn ? ` · ${student.usn}` : ""}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                    {student.email}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          email preparation
        </p>
        <p className="mt-2 text-[12px] leading-5 text-ink-soft">
          Prepare an email for the students currently waiting.
        </p>

        <dl className="mt-4 divide-y divide-line">
          {counts.map(([label, count]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-[13px] text-ink-soft">{label}</dt>
              <dd className="text-[14px] tabular-nums text-ink">
                {loading ? "…" : count?.toLocaleString() ?? "—"}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-[12px] leading-5 text-ink-faint">
          last prepared:{" "}
          {summary?.lastPreparedAt
            ? formatQueueTime(summary.lastPreparedAt)
            : loading
              ? "loading…"
              : "not yet"}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-ink-faint">
          Pending counts are saved email snapshots; suspended students remain
          listed and must be rechecked before any future send.
        </p>
      </div>

      {error && <FieldError msg={error} />}
      {preparation && (
        <div
          className="mt-4 rounded-2xl border border-line bg-paper px-4 py-3"
          aria-live="polite"
        >
          <p className="sr-only">
            {preparation.waitingStudentCount.toLocaleString()} students waiting · {preparation.uniqueRecipientCount.toLocaleString()} recipients · {preparation.addedCount.toLocaleString()} added · {preparation.alreadyPreparedCount.toLocaleString()} already prepared · {preparation.skippedCount.toLocaleString()} skipped
          </p>
          <p className="text-[13px] text-ink">Email prepared.</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            {preparation.waitingStudentCount.toLocaleString()} students waiting ·{" "}
            {preparation.uniqueRecipientCount.toLocaleString()} recipients
          </p>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            {preparation.addedCount.toLocaleString()} new recipients ·{" "}
            {preparation.alreadyPreparedCount.toLocaleString()} already prepared ·{" "}
            {preparation.skippedCount.toLocaleString()} skipped
          </p>
          <p className="mt-1 text-[12px] text-ink-faint">No emails were sent.</p>
        </div>
      )}

      {!confirming ? (
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            setPreparation(null);
            setConfirming(true);
          }}
          disabled={loading || preparing || summary === null}
          aria-label="prepare queue"
        >
          prepare email
        </Button>
      ) : (
        <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-4">
          <p className="sr-only">Prepare email queue?</p>
          <p className="text-[13px] text-ink">Prepare email?</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            {summary?.waitingStudentCount.toLocaleString() ?? "—"} students ·{" "}
            {summary?.uniqueRecipientCount.toLocaleString() ?? "—"} unique recipients
            will be prepared. No emails will be sent.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={preparing}
            >
              cancel
            </Button>
            <Button
              type="button"
              onClick={() => void prepareQueue()}
              disabled={preparing || summary === null}
              aria-label="prepare queue"
            >
              {preparing ? "preparing…" : "prepare email"}
            </Button>
          </div>
        </div>
      )}

      {preparation && (
        <div className="mt-5 rounded-[24px] border border-line bg-paper px-4 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            prepared email
          </p>
          <p className="mt-2 text-[13px] text-ink">
            Prepared for {preparation.waitingStudentCount.toLocaleString()}{" "}
            {preparation.waitingStudentCount === 1 ? "student" : "students"}
          </p>
          <p className="mt-1 text-[12px] text-ink-soft">
            {preparation.uniqueRecipientCount.toLocaleString()}{" "}
            {preparation.uniqueRecipientCount === 1 ? "recipient" : "recipients"}
          </p>
          <div className="mt-4">
            <label htmlFor="waitlist-subject" className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              subject
            </label>
            <input
              id="waitlist-subject"
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
              readOnly={sendFormLocked}
              aria-readonly={sendFormLocked || undefined}
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft read-only:bg-paper-2 read-only:text-ink-soft"
            />
          </div>

          <div className="mt-4">
            <label htmlFor="waitlist-body" className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              message
            </label>
            <textarea
              id="waitlist-body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={6}
              readOnly={sendFormLocked}
              aria-readonly={sendFormLocked || undefined}
              className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft read-only:bg-paper-2 read-only:text-ink-soft"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="subtle"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              {previewOpen ? "hide preview" : "preview"}
            </Button>
          </div>

          {previewOpen && (
            <div className="mt-4 rounded-2xl border border-line bg-paper-2 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">preview</p>
              <div className="mt-3 rounded-2xl border border-line bg-paper px-3 py-3">
                <p className="text-[12px] leading-5 text-ink-soft">from: us</p>
                <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                  subject: {draftSubject || "(no subject)"}
                </p>
                <div className="mt-3 whitespace-pre-wrap text-[12px] leading-6 text-ink">
                  {draftBody}
                </div>
              </div>
            </div>
          )}

          {!sendResult && !queueFullySent && queueSent === 0 && (
            <p className="mt-3 text-[12px] text-ink-faint">No emails have been sent.</p>
          )}

          {sendResult && (
            <div
              className="mt-4 rounded-2xl border border-line bg-paper-2 px-4 py-3"
              aria-live="polite"
            >
              <p className="text-[13px] text-ink">
                {sendResult.failed === 0 &&
                sendResult.skipped === 0 &&
                sendResult.unrecorded === 0
                  ? "✓ Email sent."
                  : "Email partially sent."}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                {sendResult.attempted.toLocaleString()} attempted ·{" "}
                {sendResult.sent.toLocaleString()} sent ·{" "}
                {sendResult.failed.toLocaleString()} failed ·{" "}
                {sendResult.skipped.toLocaleString()} skipped
                {sendResult.unrecorded > 0
                  ? ` · ${sendResult.unrecorded.toLocaleString()} unrecorded`
                  : ""}{" "}
                · {sendResult.remaining.toLocaleString()} remaining
              </p>
              {queueFullySent && (
                <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                  This prepared email has been sent.
                </p>
              )}
            </div>
          )}

          {sending ? (
            <Button
              type="button"
              className="mt-4"
              disabled
              aria-label="sending email"
            >
              sending…
            </Button>
          ) : queueFullySent ? (
            <div
              className="mt-4 rounded-2xl border border-line bg-paper-2 px-4 py-3"
              aria-live="polite"
            >
              <p className="text-[13px] text-ink">✓ Email sent.</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                {queueSent.toLocaleString()}{" "}
                {queueSent === 1 ? "recipient" : "recipients"} ·{" "}
                {queueSent.toLocaleString()} sent ·{" "}
                {queueFailed.toLocaleString()} failed ·{" "}
                {queueSkipped.toLocaleString()} skipped
              </p>
              <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                This prepared email has been sent.
              </p>
            </div>
          ) : queueNeedsRetry ? (
            <div className="mt-4">
              <div
                className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3"
                aria-live="polite"
              >
                <p className="text-[13px] text-ink">Email partially sent.</p>
                <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                  {queueSent.toLocaleString()} sent ·{" "}
                  {queueFailed.toLocaleString()} failed ·{" "}
                  {queueSkipped.toLocaleString()} skipped ·{" "}
                  {queueRemaining.toLocaleString()} remaining
                </p>
                <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                  Only failed recipients will be retried — already-sent
                  recipients are never sent again.
                </p>
              </div>
              {!sendConfirming ? (
                <Button
                  type="button"
                  className="mt-4"
                  onClick={() => setSendConfirming(true)}
                  disabled={sending}
                  aria-label="retry failed"
                >
                  retry failed
                </Button>
              ) : (
                <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-4">
                  <p className="text-[13px] text-ink">Retry the failed recipients?</p>
                  <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                    Only failed recipients will be retried. Already-sent
                    recipients are never sent again.
                  </p>
                  <p className="mt-2 text-[12px] leading-5 text-ink-soft">
                    This will send a real email through us.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSendConfirming(false)}
                      disabled={sending}
                    >
                      cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void sendQueue()}
                      disabled={sending}
                      aria-label="retry failed"
                    >
                      {sending ? "sending…" : "retry failed"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : !sendConfirming ? (
            <Button
              type="button"
              className="mt-4"
              onClick={() => setSendConfirming(true)}
              disabled={sending || preparation.uniqueRecipientCount === 0}
              aria-label="send email"
            >
              {sending ? "sending…" : "send email"}
            </Button>
          ) : (
            <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-4">
              <p className="text-[13px] text-ink">Send this email?</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                You are about to send this message to{" "}
                {preparation.uniqueRecipientCount.toLocaleString()}{" "}
                {preparation.uniqueRecipientCount === 1 ? "recipient" : "recipients"}.
              </p>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">
                Subject: {draftSubject || "(no subject)"}
              </p>
              <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-line bg-paper px-3 py-3 text-[12px] leading-6 text-ink">
                {draftBody}
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">
                This will send a real email through us.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSendConfirming(false)}
                  disabled={sending}
                >
                  cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void sendQueue()}
                  disabled={sending}
                  aria-label="send email"
                >
                  {sending ? "sending…" : "send email"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!preparation && !loading && summary && (persistedShowSent || persistedShowRetry || sending) && (
        <div
          className="mt-5 rounded-[24px] border border-line bg-paper px-4 py-4"
          aria-live="polite"
        >
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            prepared email
          </p>
          {sending ? (
            <Button
              type="button"
              className="mt-4"
              disabled
              aria-label="sending email"
            >
              sending…
            </Button>
          ) : persistedShowSent ? (
            <>
              <p className="mt-2 text-[13px] text-ink">✓ Email sent.</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                {queueSent.toLocaleString()}{" "}
                {queueSent === 1 ? "recipient" : "recipients"} ·{" "}
                {queueSent.toLocaleString()} sent ·{" "}
                {queueFailed.toLocaleString()} failed ·{" "}
                {queueSkipped.toLocaleString()} skipped
              </p>
              {summary.lastPreparedAt && (
                <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                  last prepared: {formatQueueTime(summary.lastPreparedAt)}
                </p>
              )}
              <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                This prepared email has been sent.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-ink">Email partially sent.</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                {queueSent.toLocaleString()} sent ·{" "}
                {queueFailed.toLocaleString()} failed ·{" "}
                {queueSkipped.toLocaleString()} skipped ·{" "}
                {queueRemaining.toLocaleString()} remaining
              </p>
              <div className="mt-4">
                <label htmlFor="waitlist-retry-subject" className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                  subject
                </label>
                <input
                  id="waitlist-retry-subject"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft"
                />
              </div>
              <div className="mt-4">
                <label htmlFor="waitlist-retry-body" className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                  message
                </label>
                <textarea
                  id="waitlist-retry-body"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={6}
                  className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft"
                />
              </div>
              {!sendConfirming ? (
                <Button
                  type="button"
                  className="mt-4"
                  onClick={() => setSendConfirming(true)}
                  disabled={sending}
                  aria-label="retry failed"
                >
                  retry failed
                </Button>
              ) : (
                <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-4">
                  <p className="text-[13px] text-ink">Retry the failed recipients?</p>
                  <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                    Only failed recipients will be retried. Already-sent
                    recipients are never sent again.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSendConfirming(false)}
                      disabled={sending}
                    >
                      cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void sendQueue()}
                      disabled={sending}
                      aria-label="retry failed"
                    >
                      {sending ? "sending…" : "retry failed"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- system health (Step 4) ---------------- */

type HealthState = {
  database: string;
  auth: string;
  storage: string;
  realtime: string;
  environment: string;
  version: string;
};

function healthLabel(status: string): { dot: string; text: string; label: string } {
  if (status === "ok")
    return { dot: "bg-accent", text: "text-ink", label: "Operational" };
  if (status === "not_checked")
    return { dot: "bg-line-strong", text: "text-ink-faint", label: "Not checked" };
  return { dot: "bg-accent-deep", text: "text-accent-deep", label: "Down" };
}

function HealthPanel() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inside/health")
      .then(async (res) => {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        if (!res.ok)
          throw new Error(
            typeof j?.error === "string" ? j.error : "Could not load system health.",
          );
        return j as unknown as HealthState;
      })
      .then(
        (h) => {
          if (!cancelled) setHealth(h);
        },
        (e) => {
          if (!cancelled)
            setError(e instanceof Error ? e.message : "Could not load system health.");
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inside/health");
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok)
        throw new Error(
          typeof j?.error === "string" ? j.error : "Could not load system health.",
        );
      setHealth(j as unknown as HealthState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load system health.");
    } finally {
      setLoading(false);
    }
  }

  const rows: Array<[string, string]> = health
    ? [
        ["database", health.database],
        ["auth", health.auth],
        ["storage", health.storage],
        ["realtime", health.realtime],
      ]
    : [];

  return (
    <section
      aria-label="system health"
      className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          system health
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
        >
          {loading ? "checking…" : health ? "refresh" : "check"}
        </button>
      </div>

      {error && <FieldError msg={error} />}

      {!health && !error && !loading ? (
        <p className="mt-2 text-[12px] leading-5 text-ink-faint">
          check whether core services are operational.
        </p>
      ) : null}

      {health && (
        <dl className="mt-2 divide-y divide-line">
          {rows.map(([name, status]) => {
            const s = healthLabel(status);
            return (
              <div key={name} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-[13px] text-ink-soft">{name}</dt>
                <dd className={`flex items-center gap-2 text-[13px] ${s.text}`}>
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </dd>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-[13px] text-ink-soft">environment</dt>
            <dd className="text-[13px] uppercase tracking-[0.08em] text-ink">
              {health.environment}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-[13px] text-ink-soft">version</dt>
            <dd className="text-[13px] text-ink">{health.version}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

/* ---------------- students (Step 3) ---------------- */

type StudentRow = {
  user_id: string;
  usn: string | null;
  email: string | null;
  email_verified: boolean | null;
  verification_status: string | null;
  username: string | null;
  spot: number | null;
  nickname: string | null;
  age: number | null;
  year: string | null;
  branch: string | null;
  is_active: boolean | null;
  suspension_reason: string | null;
  suspended_at: string | null;
  photo_count: number | null;
};

function studentState(s: StudentRow): string {
  if (s.is_active === false) return "suspended";
  if (!s.verification_status || s.verification_status !== "verified") return "verifying";
  if (!s.nickname) return "no profile";
  if (!s.photo_count) return "photos pending";
  return "complete";
}

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "suspended";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "all" },
  { value: "active", label: "active" },
  { value: "suspended", label: "suspended" },
];

/** Server-side student search/filter/page — no client-side counting. */
async function fetchStudentsPage(
  nextPage: number,
  term: string,
  nextStatus: StatusFilter,
): Promise<{ students: StudentRow[]; total: number }> {
  const params = new URLSearchParams({
    q: term,
    status: nextStatus,
    limit: String(PAGE_SIZE),
    offset: String(nextPage * PAGE_SIZE),
  });
  const res = await fetch(`/api/inside/students?${params.toString()}`);
  const j = (await res.json().catch(() => null)) as {
    error?: unknown;
    students?: unknown;
    total?: unknown;
  } | null;
  if (!res.ok) {
    const errMsg: unknown = j?.error;
    throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not load students.");
  }
  const students = j?.students;
  const total = j?.total;
  return {
    students: Array.isArray(students) ? (students as StudentRow[]) : [],
    total: typeof total === "number" ? total : 0,
  };
}

function StudentsPanel() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  // True until the auto-loaded first page resolves.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  // Suspending requires a reason: the button opens an inline
  // confirmation/reason form for that row instead of suspending at once.
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  async function load(nextPage: number, term: string, nextStatus: StatusFilter) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchStudentsPage(nextPage, term, nextStatus);
      setRows(r.students);
      setTotal(r.total);
      setPage(nextPage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load students.");
    } finally {
      setLoading(false);
    }
  }

  // The waitlist loads immediately — no search required to see students.
  // State updates happen only in the async continuations below (mirrors
  // HealthPanel), never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetchStudentsPage(0, "", "all").then(
      (r) => {
        if (cancelled) return;
        setRows(r.students);
        setTotal(r.total);
        setPage(0);
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load students.");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function moderate(s: StudentRow, action: "suspend" | "restore", reason?: string) {
    if (action === "suspend" && !reason?.trim()) {
      // No silent suspends: the inline reason form supplies this.
      const label = s.username ? `@${s.username}` : (s.nickname ?? s.usn ?? "this student");
      setSuspendId(s.user_id);
      setSuspendReason("");
      setError(`Tell ${label} why they're being suspended.`);
      return;
    }
    setActing(s.user_id);
    setError(null);
    try {
      const res = await fetch("/api/inside/students/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: s.user_id,
          action,
          ...(action === "suspend" && reason?.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown; isActive?: unknown } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not update the student.");
      }
      setSuspendId(null);
      setSuspendReason("");
      setRows((prev) =>
        prev.map((r) =>
          r.user_id === s.user_id
            ? {
                ...r,
                is_active: j?.isActive === true,
                suspension_reason: action === "suspend" && reason?.trim() ? reason.trim() : null,
                suspended_at: action === "suspend" ? new Date().toISOString() : null,
              }
            : r,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the student.");
    } finally {
      setActing(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-label="students" className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">students</p>
      <form
        className="mt-3 flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
          void load(0, q.trim(), status);
        }}
      >
        <input
          aria-label="search students"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="USN, username, name, email…"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="min-w-0 flex-1 rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <Button type="submit" variant="subtle" disabled={loading}>
          find
        </Button>
      </form>

      <div
        role="group"
        aria-label="filter by status"
        className="mt-3 flex flex-wrap gap-2"
      >
        {STATUS_OPTIONS.map((o) => {
          const selected = status === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setStatus(o.value);
                void load(0, submitted, o.value);
              }}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
                selected
                  ? "border-accent-soft bg-accent-wash text-accent-deep"
                  : "border-line text-ink-soft hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {error && <FieldError msg={error} />}

      <div className="mt-4">
        {loading && rows.length === 0 ? (
          <p className="text-[12px] leading-5 text-ink-faint">loading students…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            {submitted || status !== "all" ? "no students match." : "no students yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => {
              const suspended = s.is_active === false;
              const state = studentState(s);
              const confirming = suspendId === s.user_id;
              return (
                <li key={s.user_id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-ink">
                      {s.username ? `@${s.username}` : (s.nickname ?? "no name yet")}
                      {typeof s.spot === "number" ? (
                        <span className="text-ink-faint"> #{s.spot}</span>
                      ) : null}
                      <span className={suspended ? "text-accent-deep" : "text-ink-faint"}>
                        {" "}· {suspended ? "suspended" : state === "complete" ? "waiting" : state}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] leading-5 text-ink-soft">
                      {s.usn ?? "no USN yet"}
                    </p>
                    <p className="truncate text-[12px] leading-5 text-ink-faint">
                      {s.email ?? "no email yet"}
                    </p>
                    {suspended && s.suspension_reason ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-accent-deep">
                        Reason: {s.suspension_reason}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (suspended) {
                        void moderate(s, "restore");
                      } else if (confirming) {
                        setSuspendId(null);
                        setSuspendReason("");
                      } else {
                        setSuspendId(s.user_id);
                        setSuspendReason("");
                        setError(null);
                      }
                    }}
                    disabled={acting === s.user_id}
                    aria-label={`${suspended ? "Restore" : confirming ? "Cancel suspension of" : "Suspend"} ${s.username ? `@${s.username}` : (s.nickname ?? "student")}`}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    {acting === s.user_id ? "…" : suspended ? "restore" : confirming ? "cancel" : "suspend"}
                  </button>
                  </div>
                  {confirming && !suspended ? (
                    <form
                      className="mt-3 rounded-2xl border border-line bg-paper px-4 py-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!suspendReason.trim()) {
                          setError("Tell the student why they're suspended.");
                          return;
                        }
                        if (suspendReason.trim().length > 280) {
                          setError("Keep the reason under 280 characters.");
                          return;
                        }
                        void moderate(s, "suspend", suspendReason);
                      }}
                    >
                      <label
                        htmlFor={`suspend-reason-${s.user_id}`}
                        className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint"
                      >
                        why are you suspending {s.username ? `@${s.username}` : "this student"}?
                      </label>
                      <textarea
                        id={`suspend-reason-${s.user_id}`}
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        rows={2}
                        maxLength={300}
                        placeholder="the student sees this…"
                        className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      />
                      <p className="mt-1.5 text-[11px] text-ink-faint">
                        {suspendReason.trim().length}/280 · they disappear from discover, search, and profiles.
                      </p>
                      <button
                        type="submit"
                        disabled={acting === s.user_id}
                        className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-paper transition-colors hover:bg-black disabled:opacity-40"
                      >
                        {acting === s.user_id ? "suspending…" : "confirm suspension"}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="subtle" disabled={loading || page === 0} onClick={() => void load(page - 1, submitted, status)}>
            ← prev
          </Button>
          <p className="text-[12px] text-ink-faint">
            {page + 1} / {pages} · {total.toLocaleString()}
          </p>
          <Button
            variant="subtle"
            disabled={loading || page + 1 >= pages}
            onClick={() => void load(page + 1, submitted, status)}
          >
            next →
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---------------- feedback (Step 3: admin inbox + email replies) ---------------- */

type FeedbackRow = {
  id: string;
  user_id: string;
  category: string;
  message: string;
  status: string;
  created_at: string;
  admin_reply: string | null;
  replied_at: string | null;
  resolved_at: string | null;
  username: string | null;
  nickname: string | null;
  usn: string | null;
  email: string | null;
  suspension_related: boolean | null;
  related_suspension_at: string | null;
  author_suspended: boolean | null;
  author_suspension_reason: string | null;
};

type FeedbackFilter = "open" | "resolved" | "all";

const FEEDBACK_OPTIONS: Array<{ value: FeedbackFilter; label: string }> = [
  { value: "open", label: "open" },
  { value: "resolved", label: "resolved" },
  { value: "all", label: "all" },
];

function formatFeedbackTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Admin feedback inbox — a queue, not a chat interface. Rows expand for
 * full context (category, student, USN, trusted email, message, status)
 * with two explicit actions: reply by email (Brevo → the student's
 * required onboarding email) and resolve. Replying never resolves;
 * resolving never emails.
 */
function FeedbackPanel() {
  const [filter, setFilter] = useState<FeedbackFilter>("open");
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load(next: FeedbackFilter) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: next,
        limit: "20",
        offset: "0",
      });
      const res = await fetch(`/api/inside/feedback?${params.toString()}`);
      const j = (await res.json().catch(() => null)) as {
        error?: unknown;
        feedback?: unknown;
        total?: unknown;
      } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not load feedback.");
      }
      const rows = j?.feedback;
      const total = j?.total;
      setRows(Array.isArray(rows) ? (rows as FeedbackRow[]) : []);
      setTotal(typeof total === "number" ? total : 0);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load feedback.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inside/feedback?status=open&limit=20&offset=0")
      .then((res) => res.json().then((j: unknown) => ({ ok: res.ok, j: j as { error?: unknown; feedback?: unknown; total?: unknown } | null })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) {
          const errMsg: unknown = j?.error;
          throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not load feedback.");
        }
        const rows = j?.feedback;
        const total = j?.total;
        setRows(Array.isArray(rows) ? (rows as FeedbackRow[]) : []);
        setTotal(typeof total === "number" ? total : 0);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load feedback.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendReply(f: FeedbackRow) {
    if (!reply.trim()) {
      setError("Write a reply first.");
      return;
    }
    setActing(`reply:${f.id}`);
    setError(null);
    try {
      const res = await fetch("/api/inside/feedback/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId: f.id, replyBody: reply.trim() }),
      });
      const j = (await res.json().catch(() => null)) as {
        error?: unknown;
        emailSent?: unknown;
        unconfirmed?: unknown;
      } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        const suffix =
          j?.emailSent === true
            ? " (the email went out — check the row before recovering)"
            : j?.unconfirmed === true
              ? " (delivery could not be confirmed — check before retrying)"
              : "";
        throw new Error(`${typeof errMsg === "string" && errMsg ? errMsg : "Could not send the reply."}${suffix}`);
      }
      setRows((prev) =>
        prev.map((r) => (r.id === f.id ? { ...r, admin_reply: reply.trim(), replied_at: new Date().toISOString() } : r)),
      );
      setReply("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reply.");
    } finally {
      setActing(null);
    }
  }

  async function resolve(f: FeedbackRow) {
    setActing(`resolve:${f.id}`);
    setError(null);
    try {
      const res = await fetch("/api/inside/feedback/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId: f.id }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not resolve the feedback.");
      }
      if (filter === "open") {
        setRows((prev) => prev.filter((r) => r.id !== f.id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        setRows((prev) => prev.map((r) => (r.id === f.id ? { ...r, status: "RESOLVED", resolved_at: new Date().toISOString() } : r)));
      }
      if (openId === f.id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the feedback.");
    } finally {
      setActing(null);
    }
  }

  return (
    <section aria-label="feedback" className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          feedback{filter === "open" && total > 0 ? ` · ${total} open` : ""}
        </p>
        <button
          type="button"
          onClick={() => void load(filter)}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
        >
          {loading ? "loading…" : loaded ? "refresh" : "load inbox"}
        </button>
      </div>

      <div
        role="group"
        aria-label="filter feedback by status"
        className="mt-3 flex flex-wrap gap-2"
      >
        {FEEDBACK_OPTIONS.map((o) => {
          const selected = filter === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(o.value);
                setOpenId(null);
                void load(o.value);
              }}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
                selected
                  ? "border-accent-soft bg-accent-wash text-accent-deep"
                  : "border-line text-ink-soft hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {error && <FieldError msg={error} />}

      <div className="mt-2">
        {!loaded && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            load the inbox to review feedback.
          </p>
        ) : rows.length === 0 && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            {filter === "open" ? "the inbox is clear." : "nothing here."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((f) => {
              const expanded = openId === f.id;
              const who = f.username ? `@${f.username}` : (f.nickname ?? "a student");
              return (
                <li key={f.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(expanded ? null : f.id);
                      setReply("");
                    }}
                    aria-expanded={expanded}
                    className="block w-full rounded-xl text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <p className="text-[14px] text-ink">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-accent-deep">
                        [{f.category}]
                      </span>{" "}
                      {who}
                      {f.suspension_related === true ? (
                        <span className="text-accent-deep"> · suspension appeal</span>
                      ) : null}
                      {f.admin_reply ? <span className="text-ink-faint"> · replied</span> : null}
                      {f.status === "RESOLVED" ? <span className="text-ink-faint"> · resolved</span> : null}
                    </p>
                    {!expanded && (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-ink-soft">
                        {f.message}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-[12px] leading-5 text-ink-faint">
                      {f.email ?? "no email on file"} · {formatFeedbackTime(f.created_at)}
                    </p>
                  </button>

                  {expanded && (
                    <div className="mt-3 rounded-2xl border border-line bg-paper px-4 py-4">
                      <dl className="divide-y divide-line text-[13px]">
                        <div className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-faint">student</dt>
                          <dd className="text-right text-ink">{who}</dd>
                        </div>
                        <div className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-faint">USN</dt>
                          <dd className="text-right text-ink">{f.usn ?? "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-faint">email</dt>
                          <dd className="truncate text-right text-ink">{f.email ?? "no email on file"}</dd>
                        </div>
                        <div className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-faint">submitted</dt>
                          <dd className="text-right text-ink">{formatFeedbackTime(f.created_at)}</dd>
                        </div>
                        <div className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-faint">status</dt>
                          <dd className="text-right text-ink">{f.status === "RESOLVED" ? "resolved" : "open"}</dd>
                        </div>
                      </dl>
                      <p className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-ink">{f.message}</p>
                      {f.suspension_related === true ? (
                        <div className="mt-3 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-accent-deep">
                            suspension appeal
                            {f.related_suspension_at ? ` · suspended ${formatFeedbackTime(f.related_suspension_at)}` : ""}
                          </p>
                          <p className="mt-1 text-[13px] leading-6 text-ink">
                            <span className="text-ink-soft">Reason for suspension: </span>
                            {f.author_suspension_reason ?? (f.author_suspended === false ? "account has since been restored." : "—")}
                          </p>
                          {f.author_suspended === false ? (
                            <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                              the author is no longer suspended — restore already happened, if it was needed.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {f.admin_reply && (
                        <div className="mt-3 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-accent-deep">
                            reply sent{f.replied_at ? ` · ${formatFeedbackTime(f.replied_at)}` : ""}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-ink">{f.admin_reply}</p>
                        </div>
                      )}

                      {f.status !== "RESOLVED" && !f.admin_reply && (
                        <>
                          <label
                            htmlFor={`feedback-reply-${f.id}`}
                            className="mt-4 block text-[11px] uppercase tracking-[0.14em] text-ink-faint"
                          >
                            reply by email
                          </label>
                          <textarea
                            id={`feedback-reply-${f.id}`}
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            rows={3}
                            placeholder="write to the student…"
                            className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          />
                        </>
                      )}
                      {f.status !== "RESOLVED" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!f.admin_reply && (
                            <button
                              type="button"
                              onClick={() => void sendReply(f)}
                              disabled={acting !== null}
                              className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-paper transition-colors hover:bg-black disabled:opacity-40"
                            >
                              {acting === `reply:${f.id}` ? "sending…" : "reply by email"}
                            </button>
                          )}
                          <button
                            type="button"
                           onClick={() => setConfirming(f.id)}
                           disabled={acting !== null}
                            className="inline-flex min-h-[44px] items-center rounded-full border border-line px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                          >
                             {acting === `resolve:${f.id}` ? "…" : "resolve"}
                           </button>
                           {confirming === f.id && (
                             <div className="basis-full rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
                               <p className="text-[13px] text-ink">Resolve this feedback?</p>
                               <p className="mt-1 text-[12px] leading-5 text-ink-soft">This removes it from the open inbox.</p>
                               <div className="mt-3 flex flex-wrap gap-2">
                                 <Button type="button" variant="ghost" onClick={() => setConfirming(null)} disabled={acting !== null}>cancel</Button>
                                 <Button type="button" onClick={() => { setConfirming(null); void resolve(f); }} disabled={acting !== null}>confirm resolve</Button>
                               </div>
                             </div>
                           )}
                         </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------------- reports (Step 3) ---------------- */

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reporter_username: string | null;
  reporter_nickname: string | null;
  reported_username: string | null;
  reported_nickname: string | null;
  reported_is_active: boolean | null;
};

function ReportsPanel() {
  const PAGE_SIZE = 20;
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "resolved" | "dismissed" } | null>(null);
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  async function load(nextPage = 0) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inside/reports?status=unresolved&limit=${PAGE_SIZE}&offset=${nextPage * PAGE_SIZE}`);
      const j = (await res.json().catch(() => null)) as {
        error?: unknown;
        reports?: unknown;
        total?: unknown;
      } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not load reports.");
      }
      const rows = j?.reports;
      const total = j?.total;
      setRows(Array.isArray(rows) ? (rows as ReportRow[]) : []);
      setTotal(typeof total === "number" ? total : 0);
      setPage(nextPage);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  async function resolve(report: ReportRow, resolution: "resolved" | "dismissed") {
    setActing(report.id);
    setError(null);
    try {
      const res = await fetch("/api/inside/reports/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id, resolution }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not resolve the report.");
      }
      setRows((prev) => prev.filter((r) => r.id !== report.id));
      setTotal((t) => Math.max(0, t - 1));
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the report.");
    } finally {
      setActing(null);
    }
  }

  async function suspendReported(report: ReportRow, reason: string) {
    if (!reason.trim()) {
      setError("Tell the student why they're suspended.");
      return;
    }
    if (reason.trim().length > 280) {
      setError("Keep the reason under 280 characters.");
      return;
    }
    setActing(report.id);
    setError(null);
    try {
      const res = await fetch("/api/inside/students/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: report.reported_id, action: "suspend", reason: reason.trim() }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : "Could not update the student.");
      }
      setRows((prev) =>
        prev.map((r) => (r.id === report.id ? { ...r, reported_is_active: false } : r)),
      );
      setSuspendId(null);
      setSuspendReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the student.");
    } finally {
      setActing(null);
    }
  }

  return (
    <section aria-label="reports" className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          reports{total > 0 ? ` · ${total} open` : ""}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
        >
           {loading ? "loading…" : loaded ? "refresh" : "load queue"}
        </button>
      </div>

      {error && <FieldError msg={error} />}

      <div className="mt-2">
         {loaded && rows.length === 0 && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            {total === 0 && !error ? "the queue is clear." : "no reports on this page."}
          </p>
        ) : !loaded && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">load the queue to review reports.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-[14px] text-ink">{r.reason}</p>
                <p className="mt-0.5 text-[12px] leading-5 text-ink-faint">
                  about {r.reported_username ? `@${r.reported_username}` : (r.reported_nickname ?? "someone")}
                  {r.reported_is_active === false ? " · suspended" : ""}
                  {r.details ? ` — ${r.details}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                     onClick={() => setConfirming({ id: r.id, action: "resolved" })}
                    disabled={acting === r.id}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    resolve
                  </button>
                  <button
                    type="button"
                     onClick={() => setConfirming({ id: r.id, action: "dismissed" })}
                    disabled={acting === r.id}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    dismiss
                  </button>
                  {r.reported_is_active !== false && (
                    <button
                      type="button"
                       onClick={() => { setSuspendId(suspendId === r.id ? null : r.id); setSuspendReason(""); setError(null); }}
                      disabled={acting === r.id}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                     >
                       {suspendId === r.id ? "cancel suspension" : "suspend reported"}
                     </button>
                   )}
                   {confirming?.id === r.id && (
                     <div className="mt-3 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
                       <p className="text-[13px] text-ink">{confirming.action === "resolved" ? "Resolve this report?" : "Dismiss this report?"}</p>
                       <div className="mt-3 flex flex-wrap gap-2">
                         <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>cancel</Button>
                         <Button type="button" onClick={() => void resolve(r, confirming.action)}>confirm {confirming.action === "resolved" ? "resolve" : "dismiss"}</Button>
                       </div>
                     </div>
                   )}
                   {suspendId === r.id && (
                     <form className="mt-3 rounded-2xl border border-line bg-paper px-4 py-4" onSubmit={(e) => { e.preventDefault(); void suspendReported(r, suspendReason); }}>
                       <label htmlFor={`report-suspend-reason-${r.id}`} className="block text-[11px] uppercase tracking-[0.14em] text-ink-faint">why are you suspending {r.reported_username ? `@${r.reported_username}` : "this student"}?</label>
                       <textarea id={`report-suspend-reason-${r.id}`} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={2} maxLength={300} placeholder="the student sees this…" className="mt-2 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft" />
                       <p className="mt-1.5 text-[11px] text-ink-faint">{suspendReason.trim().length}/280 · they disappear from discover, search, and profiles.</p>
                       <Button type="submit" className="mt-3" disabled={acting === r.id}>{acting === r.id ? "suspending…" : "confirm suspension"}</Button>
                     </form>
                   )}
                </div>
              </li>
            ))}
         </ul>
       )}
      </div>
      {loaded && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="subtle" disabled={loading || page === 0} onClick={() => void load(page - 1)}>← prev</Button>
          <p className="text-[12px] text-ink-faint">{page + 1} / {Math.ceil(total / PAGE_SIZE)} · {total.toLocaleString()}</p>
          <Button variant="subtle" disabled={loading || page + 1 >= Math.ceil(total / PAGE_SIZE)} onClick={() => void load(page + 1)}>next →</Button>
        </div>
      )}
    </section>
  );
}
