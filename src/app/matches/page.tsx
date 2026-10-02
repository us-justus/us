import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { getMatches, type MatchListItem } from "@/lib/matches/queries";
import { MatchesError } from "@/components/matches/matches-error";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return "yesterday";
  const d = Math.floor(diff / day);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function displayName(m: MatchListItem): string {
  if (m.username) return `@${m.username}`;
  return m.nickname ?? "someone";
}

function identityLine(m: MatchListItem): string | null {
  const parts: string[] = [];
  if (m.nickname && m.age !== null) parts.push(`${m.nickname}, ${m.age}`);
  else if (m.nickname) parts.push(m.nickname);
  else if (m.age !== null) parts.push(`${m.age}`);
  if (m.branch) parts.push(m.branch);
  if (m.year) parts.push(`${m.year} year`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * /matches — the current user's matches only.
 *
 * Same guards as /discover + /chat: product session server-side, then the
 * server-authoritative launch gate (never navigation-hiding alone). The
 * match list itself is server-authorized (getMatches queries only rows
 * containing the caller; matches RLS enforces membership on top), and each
 * row navigates by the real match id to /chat/[matchId], which re-verifies
 * membership server-side.
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

  const { matches, error } = await getMatches(supabase, user.id);

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        matches
      </p>
      <h1 className="mt-3 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        it&apos;s a match.
      </h1>

      {error ? (
        <MatchesError message={error} />
      ) : matches.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display text-[22px] tracking-[-0.02em] text-ink">no matches yet.</p>
          <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-6 text-ink-soft">
            when you both like each other, they will appear here.
          </p>
          <div aria-hidden className="mx-auto mt-8 h-px w-12 bg-line-strong" />
          <Link
            href="/discover"
            className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            keep discovering
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[14px] leading-6 text-ink-soft">
            {matches.length === 1 ? "one person liked you back." : `${matches.length} people liked you back.`}
          </p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {matches.map((m, i) => {
              const name = displayName(m);
              const line = identityLine(m);
              const initial = (m.username ?? m.nickname ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
              return (
                <li key={m.id} className="flex items-center gap-4 py-4">
                  {m.username ? (
                    <Link
                      href={`/u/${m.username}`}
                      aria-label={`view ${name}'s profile`}
                      className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper-2 transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {m.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.photo_url}
                          alt=""
                          width={56}
                          height={56}
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchPriority={i === 0 ? "high" : "auto"}
                          decoding="async"
                          className="h-14 w-14 object-cover"
                        />
                      ) : (
                        <span aria-hidden className="text-[20px] text-ink-soft">
                          {initial}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span
                      aria-hidden
                      className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper-2"
                    >
                      {m.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.photo_url}
                          alt=""
                          width={56}
                          height={56}
                          loading={i === 0 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-14 w-14 object-cover"
                        />
                      ) : (
                        <span className="text-[20px] text-ink-soft">{initial}</span>
                      )}
                    </span>
                  )}
                  <Link
                    href={`/chat/${m.id}`}
                    aria-label={`open conversation with ${name}`}
                    className="group flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium leading-6 text-ink transition-colors group-hover:text-accent-deep">
                        {name}
                      </span>
                      {line && (
                        <span className="block truncate text-[13px] leading-5 text-ink-soft">{line}</span>
                      )}
                      <span className="mt-0.5 block text-[12px] tracking-wide text-ink-faint">
                        matched {timeAgo(m.created_at)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="shrink-0 text-[16px] text-ink-faint transition-colors group-hover:text-accent-deep"
                    >
                      →
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
