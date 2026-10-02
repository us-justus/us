"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NotificationItem } from "@/lib/notifications/queries";
import { ignoreNotificationAction, likeBackNotificationAction } from "@/lib/notifications/actions";
import { cn } from "@/lib/utils/cn";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 2 * day) return "yesterday";
  const d = Math.floor(diff / day);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Small round actor avatar. Falls back to an initial — never a raw ID. */
function ActorAvatar({
  n,
  eager,
}: {
  n: NotificationItem;
  eager?: boolean;
}) {
  const label = n.actor_username ? `@${n.actor_username}` : (n.actor_nickname ?? "someone");
  const initial = (n.actor_username ?? n.actor_nickname ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  const avatar = n.actor_photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={n.actor_photo_url}
      alt=""
      width={40}
      height={40}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="h-10 w-10 rounded-full object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="flex h-10 w-10 items-center justify-center rounded-full bg-paper-2 text-[15px] text-ink-soft"
    >
      {initial}
    </span>
  );

  if (n.actor_username) {
    return (
      <Link
        href={`/u/${n.actor_username}`}
        aria-label={`view ${label}'s profile`}
        className="shrink-0 overflow-hidden rounded-full border border-line transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {avatar}
      </Link>
    );
  }
  return (
    <span aria-hidden className="shrink-0 overflow-hidden rounded-full border border-line">
      {avatar}
    </span>
  );
}

function ActorName({ n }: { n: NotificationItem }) {
  if (n.actor_username) {
    return (
      <Link
        href={`/u/${n.actor_username}`}
        className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm"
      >
        @{n.actor_username}
      </Link>
    );
  }
  if (n.actor_nickname) return <span className="font-medium text-ink">{n.actor_nickname}</span>;
  return <span className="text-ink">someone</span>;
}

/**
 * Editorial notification history (spec/3D3.md).
 *
 * - Server-rendered initial state; the DB stays the source of truth.
 * - Opening the list marks visible rows read (single read-all request).
 * - Delete is per-row soft-delete — it never touches the like/match.
 * - No polling, no realtime channel; fresh state on each navigation.
 */
export function NotificationsList({ initial, initialUnread }: { initial: NotificationItem[]; initialUnread: number }) {
  const [items, setItems] = useState(initial);
  const [failed, setFailed] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, "like" | "ignore" | undefined>>({});
  const [errorById, setErrorById] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (initialUnread <= 0) return;
    let cancelled = false;
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: "read" }),
    })
      .then(() => {
        if (cancelled) return;
        // Read rows stay visible — only the unread marker clears.
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialUnread]);

  async function remove(id: string) {
    setFailed(null);
    const prev = items;
    setItems((p) => p.filter((n) => n.id !== id));
    const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setItems(prev);
      setFailed("couldn't clear that one — try again.");
    }
  }

  async function refresh() {
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return;
    const j = (await res.json().catch(() => null)) as { notifications?: NotificationItem[] } | null;
    if (Array.isArray(j?.notifications)) setItems(j.notifications as NotificationItem[]);
  }

  async function likeBack(n: NotificationItem) {
    if (pendingById[n.id]) return;
    setPendingById((p) => ({ ...p, [n.id]: "like" }));
    setErrorById((p) => ({ ...p, [n.id]: undefined }));
    setFailed(null);
    try {
      const r = await likeBackNotificationAction(n.id);
      if (!r.ok) {
        setErrorById((p) => ({ ...p, [n.id]: r.error }));
        return;
      }
      // Resolved either way (fresh like or already-handled elsewhere):
      // hide the competing controls immediately, then pull the MATCH row.
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((row) =>
          row.id === n.id ? { ...row, resolved_at: row.resolved_at ?? now, read_at: row.read_at ?? now } : row,
        ),
      );
      await refresh();
    } catch {
      setErrorById((p) => ({ ...p, [n.id]: "couldn't like back — try again." }));
    } finally {
      setPendingById((p) => {
        const next = { ...p };
        delete next[n.id];
        return next;
      });
    }
  }

  async function ignore(n: NotificationItem) {
    if (pendingById[n.id]) return;
    setPendingById((p) => ({ ...p, [n.id]: "ignore" }));
    setErrorById((p) => ({ ...p, [n.id]: undefined }));
    setFailed(null);
    try {
      const r = await ignoreNotificationAction(n.id);
      if (!r.ok) {
        setErrorById((p) => ({ ...p, [n.id]: r.error }));
        return;
      }
      // Resolution only — the underlying like stays intact and Discover is
      // untouched. The row remains in history without action controls.
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((row) =>
          row.id === n.id ? { ...row, resolved_at: row.resolved_at ?? now, read_at: row.read_at ?? now } : row,
        ),
      );
    } catch {
      setErrorById((p) => ({ ...p, [n.id]: "couldn't ignore that — try again." }));
    } finally {
      setPendingById((p) => {
        const next = { ...p };
        delete next[n.id];
        return next;
      });
    }
  }

  if (!items.length) {
    return (
      <div className="py-12 text-center">
        <p className="font-display text-[22px] tracking-[-0.02em] text-ink">quiet for now.</p>
        <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-6 text-ink-soft">
          when someone likes you, or it&apos;s a match, it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {failed && (
        <p role="alert" className="mb-4 text-[14px] text-accent-deep">
          {failed}
        </p>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {items.map((n, i) => {
          const unread = !n.read_at;
          return (
            <li
              key={n.id}
              className={cn(
                "flex items-start gap-3 py-5 transition-colors",
                unread && "bg-accent-wash/40",
              )}
            >
              <ActorAvatar n={n} eager={i === 0} />
              <div className="min-w-0 flex-1">
                {n.type === "MATCH" ? (
                  <>
                    <p className={cn("text-[15px] leading-6", unread ? "text-ink font-medium" : "text-ink-soft")}>
                      <ActorName n={n} />
                    </p>
                    <p className="mt-1 font-display text-[20px] tracking-[-0.02em] text-ink">
                      it&apos;s a match<span aria-hidden className="text-accent">.</span>
                    </p>
                    <p className="mt-0.5 text-[14px] leading-6 text-ink-soft">you both liked each other.</p>
                    {n.reference_id && (
                      <Link
                        href={`/chat/${n.reference_id}`}
                        className="mt-2 inline-flex min-h-[44px] items-center text-[14px] text-accent-deep underline decoration-accent-soft underline-offset-4 transition-colors hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm"
                      >
                        continue the conversation →
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    <p className={cn("text-[15px] leading-6", unread ? "text-ink font-medium" : "text-ink-soft")}>
                      <ActorName n={n} /> <span className="font-normal">liked you.</span>
                    </p>
                    {n.actor_username && (
                      <Link
                        href={`/u/${n.actor_username}`}
                        className="mt-2 inline-flex min-h-[44px] items-center text-[14px] text-accent-deep underline decoration-accent-soft underline-offset-4 transition-colors hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm"
                      >
                        view profile →
                      </Link>
                    )}
                    {!n.resolved_at && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <button
                          type="button"
                          onClick={() => void likeBack(n)}
                          disabled={!!pendingById[n.id]}
                          aria-busy={pendingById[n.id] === "like"}
                          aria-label={
                            n.actor_username ? `like back @${n.actor_username}` : "like back"
                          }
                          className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
                        >
                          {pendingById[n.id] === "like" ? "liking…" : "like back ♡"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void ignore(n)}
                          disabled={!!pendingById[n.id]}
                          aria-busy={pendingById[n.id] === "ignore"}
                          aria-label={
                            n.actor_username
                              ? `ignore like from @${n.actor_username}`
                              : "ignore this notification"
                          }
                          className="inline-flex min-h-[44px] items-center px-3 text-[14px] text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 rounded-full"
                        >
                          {pendingById[n.id] === "ignore" ? "ignoring…" : "ignore"}
                        </button>
                      </div>
                    )}
                    {errorById[n.id] && (
                      <p role="alert" className="mt-1 text-[13px] leading-5 text-accent-deep">
                        {errorById[n.id]}
                      </p>
                    )}
                  </>
                )}
                <p className="mt-1 text-[12px] tracking-wide text-ink-faint">{timeAgo(n.created_at)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-1">
                {unread ? (
                  <span aria-label="unread" className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                ) : (
                  <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5" />
                )}
                <button
                  type="button"
                  onClick={() => void remove(n.id)}
                  aria-label="clear notification"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[18px] leading-none text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
