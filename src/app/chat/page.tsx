import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { getConversations, type ConversationListItem } from "@/lib/chat/inbox";
import { InboxRefresh } from "@/components/chat/inbox-refresh";
import { InboxError } from "@/components/chat/inbox-error";

export const dynamic = "force-dynamic";

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (sameDay(d, yesterday)) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function displayName(c: ConversationListItem): string {
  if (c.username) return `@${c.username}`;
  return c.nickname ?? "someone";
}

function identityLine(c: ConversationListItem): string | null {
  const parts: string[] = [];
  if (c.nickname && c.age !== null) parts.push(`${c.nickname}, ${c.age}`);
  else if (c.nickname) parts.push(c.nickname);
  else if (c.age !== null) parts.push(`${c.age}`);
  if (c.branch) parts.push(c.branch);
  if (c.year) parts.push(`${c.year} year`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * /chat — the current user's conversations.
 *
 * /matches = people I matched with. /chat = conversations I have. Each row
 * navigates directly to /chat/[matchId], which re-verifies membership
 * server-side. Same guards as /matches + /discover: product session
 * server-side, then the server-authoritative launch gate.
 */
export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Reuse the known user — no second auth.getUser() on this request.
  const session = await getProductSession(user ?? null);
  const guard = guardProductSession(session);
  if (guard) redirect(guard);
  const launchGuard = guardLaunch(await getLaunchState());
  if (launchGuard) redirect(launchGuard);
  if (!user) redirect("/login");

  const { conversations, hasMatches, error } = await getConversations(supabase, user.id);

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        chat
      </p>
      <h1 className="mt-3 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        say hello.
      </h1>

      {error ? (
        <InboxError message={error} />
      ) : conversations.length === 0 ? (
        hasMatches ? (
          <div className="py-12 text-center">
            <p className="font-display text-[22px] tracking-[-0.02em] text-ink">your matches are waiting.</p>
            <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-6 text-ink-soft">
              say hello — your first message starts the conversation.
            </p>
            <div aria-hidden className="mx-auto mt-8 h-px w-12 bg-line-strong" />
            <Link
              href="/matches"
              className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              view matches
            </Link>
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="font-display text-[22px] tracking-[-0.02em] text-ink">no conversations yet.</p>
            <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-6 text-ink-soft">
              when you both like each other, you can start talking here.
            </p>
            <div aria-hidden className="mx-auto mt-8 h-px w-12 bg-line-strong" />
            <Link
              href="/discover"
              className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              keep discovering
            </Link>
          </div>
        )
      ) : (
        <>
          <InboxRefresh matchIds={conversations.map((c) => c.matchId)} />
          <p className="mt-3 text-[14px] leading-6 text-ink-soft">
            {conversations.length === 1 ? "one conversation." : `${conversations.length} conversations.`}
          </p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {conversations.map((c, i) => {
              const name = displayName(c);
              const line = identityLine(c);
              const initial = (c.username ?? c.nickname ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
              return (
                <li key={c.matchId}>
                  <Link
                    href={`/chat/${c.matchId}`}
                    aria-label={c.unread ? `open conversation with ${name}, unread messages` : `open conversation with ${name}`}
                    className="group flex min-h-[64px] min-w-0 items-center gap-4 rounded-sm py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper-2"
                    >
                      {c.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.photo_url}
                          alt=""
                          width={56}
                          height={56}
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchPriority={i === 0 ? "high" : "auto"}
                          decoding="async"
                          className="h-14 w-14 object-cover"
                        />
                      ) : (
                        <span className="text-[20px] text-ink-soft">{initial}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="block truncate text-[15px] font-medium leading-6 text-ink transition-colors group-hover:text-accent-deep">
                          {name}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {c.lastAt && (
                            <span className="text-[12px] tracking-wide text-ink-faint">
                              {formatStamp(c.lastAt)}
                            </span>
                          )}
                          {c.unread ? (
                            <span aria-label="unread" className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                          ) : (
                            <span aria-hidden className="inline-block h-1.5 w-1.5" />
                          )}
                        </span>
                      </span>
                      {line && (
                        <span className="block truncate text-[13px] leading-5 text-ink-soft">{line}</span>
                      )}
                      <span
                        className={
                          c.unread
                            ? "block truncate text-[13px] font-medium leading-5 text-ink"
                            : "block truncate text-[13px] leading-5 text-ink-faint"
                        }
                      >
                        {c.lastBody ? (
                          <>
                            {c.lastIsOwn && <span>You: </span>}
                            {c.lastBody}
                          </>
                        ) : (
                          "say hello — no messages yet."
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
