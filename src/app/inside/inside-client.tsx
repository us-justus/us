"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/onboarding/shell";

type DashboardInitial = {
  launched: boolean;
  launchedAt: string | null;
  version: string;
  totalUsers: number;
  waiting: number;
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
  const [adminKey, setAdminKey] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enter() {
    setError(null);
    if (!identifier.trim() || !password || !adminKey) {
      setError("Enter your identifier, password, and admin key.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/inside/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password, adminKey }),
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
              enterKeyHint="next"
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

        <div className="mt-4">
          <label
            htmlFor="inside-key"
            className="text-[11px] uppercase tracking-[0.14em] text-ink-faint"
          >
            admin key
          </label>
          <div className="relative mt-2">
            <input
              id="inside-key"
              type={showKey ? "text" : "password"}
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              className="w-full rounded-2xl border border-line bg-paper px-4 py-3.5 pr-16 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "hide admin key" : "show admin key"}
              className="absolute right-2 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full text-[12px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-deep"
            >
              {showKey ? "hide" : "show"}
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
  const [launched, setLaunched] = useState(initial.launched);
  const [launchedAt, setLaunchedAt] = useState<string | null>(initial.launchedAt);
  const [version, setVersion] = useState(initial.version);
  const [versionDraft, setVersionDraft] = useState(initial.version);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function setLaunch(next: boolean, nextVersion?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/inside/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launched: next,
          ...(nextVersion !== undefined ? { version: nextVersion } : {}),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not update.");
      setLaunched(j.launched === true);
      setLaunchedAt(typeof j.launchedAt === "string" ? j.launchedAt : null);
      if (typeof j.version === "string") {
        setVersion(j.version);
        setVersionDraft(j.version);
      }
      setNotice(j.launched === true ? "us is LIVE." : "back to pre-launch.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

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

      {/* launch state */}
      <section aria-label="launch state" className="mt-8 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">launch</p>
        <p className="mt-2 font-display text-[28px] leading-none tracking-[-0.02em]">
          {launched ? "LIVE" : "PRE-LAUNCH"}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-ink-soft">
          {launchedAt ? `launched ${new Date(launchedAt).toLocaleString()}` : "never launched yet."}
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="subtle"
            disabled={busy || launched}
            onClick={() => void setLaunch(true)}
            className="flex-1"
          >
            {busy ? "working…" : "go live"}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || !launched}
            onClick={() => void setLaunch(false)}
            className="flex-1"
          >
            {busy ? "working…" : "back to pre-launch"}
          </Button>
        </div>
        {notice && <FieldError msg={notice} />}
      </section>

      {/* pre-launch version */}
      <section aria-label="pre-launch version" className="mt-4 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">pre-launch version</p>
        <form
          className="mt-3 flex items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = versionDraft.trim();
            if (!/^v[0-9]{1,3}$/.test(v)) {
              setNotice("Version looks like v1, v2, … (up to v999).");
              return;
            }
            void setLaunch(launched, v);
          }}
        >
          <input
            aria-label="pre-launch version"
            type="text"
            value={versionDraft}
            onChange={(e) => setVersionDraft(e.target.value)}
            placeholder="v1"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="w-28 rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          <Button type="submit" variant="subtle" disabled={busy || versionDraft.trim() === version}>
            set
          </Button>
        </form>
        <p className="mt-3 text-[12px] leading-5 text-ink-soft">
          current: {version} — future pre-launch experiences plug in here without touching launch
          state.
        </p>
      </section>

      {/* campus overview */}
      <section aria-label="campus overview" className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">total users</p>
          <p className="mt-2 font-display text-[32px] leading-none tracking-[-0.02em]">
            {initial.countsLive ? initial.totalUsers.toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">waiting</p>
          <p className="mt-2 font-display text-[32px] leading-none tracking-[-0.02em]">
            {initial.countsLive ? initial.waiting.toLocaleString() : "—"}
          </p>
        </div>
      </section>
      {!initial.countsLive && (
        <p className="mt-3 text-[12px] leading-5 text-ink-faint">
          counts unavailable — the database may predate the inside migration.
        </p>
      )}
    </div>
  );
}
