"use client";

import { useEffect, useState } from "react";
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

// Deterministic launch-timestamp formatter: explicit locale + timezone so
// SSR and client hydration produce identical output.
const LAUNCHED_AT_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function formatLaunchedAt(iso: string): string {
  return LAUNCHED_AT_FORMATTER.format(new Date(iso));
}

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
          {launchedAt ? `launched ${formatLaunchedAt(launchedAt)}` : "never launched yet."}
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

      <HealthPanel />
      <StudentsPanel />
      <ReportsPanel />
    </div>
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
        const j = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(
            typeof j?.error === "string" ? j.error : "Could not load system health.",
          );
        return j as HealthState;
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
      const j = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          typeof j?.error === "string" ? j.error : "Could not load system health.",
        );
      setHealth(j as HealthState);
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

function StudentsPanel() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  async function load(nextPage: number, term: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: term,
        limit: String(PAGE_SIZE),
        offset: String(nextPage * PAGE_SIZE),
      });
      const res = await fetch(`/api/inside/students?${params.toString()}`);
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not load students.");
      setRows(Array.isArray(j.students) ? j.students : []);
      setTotal(typeof j.total === "number" ? j.total : 0);
      setPage(nextPage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load students.");
    } finally {
      setLoading(false);
    }
  }

  async function moderate(s: StudentRow, action: "suspend" | "restore") {
    if (action === "suspend") {
      const label = s.username ? `@${s.username}` : (s.nickname ?? s.usn ?? "this student");
      if (!window.confirm(`Suspend ${label}? They disappear from discover, search, and profiles.`)) return;
    }
    setActing(s.user_id);
    setError(null);
    try {
      const res = await fetch("/api/inside/students/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: s.user_id, action }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not update the student.");
      setRows((prev) =>
        prev.map((r) => (r.user_id === s.user_id ? { ...r, is_active: j.isActive === true } : r)),
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
          void load(0, q.trim());
        }}
      >
        <input
          aria-label="search students"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="username, name, USN…"
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

      {error && <FieldError msg={error} />}

      <div className="mt-4">
        {rows.length === 0 && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            {submitted || total > 0 ? "no students match." : "search above to list students."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => {
              const suspended = s.is_active === false;
              return (
                <li key={s.user_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-ink">
                      {s.username ? `@${s.username}` : (s.nickname ?? "no name yet")}
                      {s.spot ? <span className="text-ink-faint"> #{s.spot}</span> : null}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] leading-5 text-ink-faint">
                      {[s.usn, s.email, studentState(s)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void moderate(s, suspended ? "restore" : "suspend")}
                    disabled={acting === s.user_id}
                    aria-label={`${suspended ? "Restore" : "Suspend"} ${s.username ? `@${s.username}` : (s.nickname ?? "student")}`}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    {acting === s.user_id ? "…" : suspended ? "restore" : "suspend"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="subtle" disabled={loading || page === 0} onClick={() => void load(page - 1, submitted)}>
            ← prev
          </Button>
          <p className="text-[12px] text-ink-faint">
            {page + 1} / {pages} · {total.toLocaleString()}
          </p>
          <Button
            variant="subtle"
            disabled={loading || page + 1 >= pages}
            onClick={() => void load(page + 1, submitted)}
          >
            next →
          </Button>
        </div>
      )}
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
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inside/reports?status=unresolved&limit=20&offset=0");
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not load reports.");
      setRows(Array.isArray(j.reports) ? j.reports : []);
      setTotal(typeof j.total === "number" ? j.total : 0);
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
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not resolve the report.");
      setRows((prev) => prev.filter((r) => r.id !== report.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the report.");
    } finally {
      setActing(null);
    }
  }

  async function suspendReported(report: ReportRow) {
    const label = report.reported_username ? `@${report.reported_username}` : "the reported student";
    if (!window.confirm(`Suspend ${label}? They disappear from discover, search, and profiles.`)) return;
    setActing(report.id);
    setError(null);
    try {
      const res = await fetch("/api/inside/students/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: report.reported_id, action: "suspend", reason: `report ${report.id}` }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Could not update the student.");
      setRows((prev) =>
        prev.map((r) => (r.id === report.id ? { ...r, reported_is_active: false } : r)),
      );
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
          {loading ? "loading…" : rows.length ? "refresh" : "load queue"}
        </button>
      </div>

      {error && <FieldError msg={error} />}

      <div className="mt-2">
        {rows.length === 0 && !loading ? (
          <p className="text-[12px] leading-5 text-ink-faint">
            {total === 0 && !error ? "the queue is clear." : "load the queue to review reports."}
          </p>
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
                    onClick={() => void resolve(r, "resolved")}
                    disabled={acting === r.id}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    resolve
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolve(r, "dismissed")}
                    disabled={acting === r.id}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                  >
                    dismiss
                  </button>
                  {r.reported_is_active !== false && (
                    <button
                      type="button"
                      onClick={() => void suspendReported(r)}
                      disabled={acting === r.id}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep disabled:opacity-40"
                    >
                      suspend reported
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
