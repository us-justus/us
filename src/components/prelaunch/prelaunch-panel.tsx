import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { InviteButton } from "@/components/prelaunch/invite-button";

/**
 * PRE_LAUNCH home (STEP 3A slice).
 *
 * Shown on `/` to campus/permanent sessions while `launched = false`
 * instead of bouncing to /discover (which redirects back here — a loop).
 * Server-gated Discover/Match/Chat stay locked; this panel only surfaces
 * the already-assigned public identity: @username + permanent #spot.
 *
 * Hierarchy: identity first → anticipation → explanation → future actions.
 * Locked features and not-yet-active entries are plain non-interactive
 * text — never links or buttons — so nothing looks tappable that isn't.
 *
 * Visual language matches the landing: blush wash field, dark editorial
 * type, ink primary CTA, coral dot accent. No dashboard, no animation
 * beyond the static layout. No countdown (no authoritative launch
 * timestamp exists yet), no Three.js, no polling.
 */
export function PrelaunchPanel({ username, spot }: { username: string | null; spot: number | null }) {
  const claimed = username !== null && username !== "";
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <p className="mt-3 flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          pre-launch · you&apos;re in
        </p>

        {claimed ? (
          <>
            <h1 className="mt-4 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
              @{username}
            </h1>
            <p className="mt-4 text-[13px] tracking-[0.14em] uppercase text-ink-soft">your spot</p>
            <p className="font-display text-[56px] leading-none tracking-[-0.03em] text-ink">
              #{spot ?? "—"}
            </p>
            <p className="mt-6 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
              the campus is gathering. permanent — yours across logout, login,
              and any future name.
            </p>
            <p className="mt-2 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
              matching opens at launch.
            </p>

            <div className="mt-8 flex w-full flex-col items-center gap-3">
              <Link
                href="/profile"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                view your profile
              </Link>
              <Link
                href="/settings"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[13px] text-[12px] tracking-[0.16em] uppercase font-medium text-ink transition-colors hover:bg-paper-2 hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                account settings
              </Link>
            </div>

            <div className="mt-10 w-full text-left">
              <div className="h-px bg-accent-soft" />
              <ul className="flex flex-col" aria-label="locked until launch">
                <LockedRow name="discover" note="coming at launch" />
                <LockedRow name="matches" note="coming at launch" />
                <LockedRow name="chat" note="available after matching" />
              </ul>
              <div className="h-px bg-accent-soft" />
              <ul className="mt-6 flex flex-col gap-1" aria-label="coming soon">
                <li className="flex min-h-[44px] items-center justify-between gap-4 py-2.5">
                  <Link
                    href="/search"
                    className="text-[14px] tracking-[0.04em] text-ink lowercase underline underline-offset-4 decoration-line-strong transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    search
                  </Link>
                  <span className="shrink-0 text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                    find your campus →
                  </span>
                </li>
                <li className="flex min-h-[44px] items-center justify-between gap-4 py-2.5">
                  <span className="text-[14px] tracking-[0.04em] text-ink lowercase">invites</span>
                  <span className="shrink-0 text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                    share your link →
                  </span>
                </li>
                <li className="py-2.5">
                  <InviteButton username={username} spot={spot} />
                </li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
              claim your name.
            </h1>
            <p className="mt-6 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
              choose your username to reserve your permanent spot on campus.
            </p>
            <div className="mt-8 flex w-full flex-col items-center gap-3">
              <Link
                href="/onboarding/profile"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                choose your username →
              </Link>
            </div>
          </>
        )}
      </section>

      <div className="border-t border-accent-soft bg-paper">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-3 px-6 py-6 sm:flex-row sm:px-8 text-[11px] tracking-[0.12em] uppercase text-ink-faint">
          <span>est. 2026 — built for your campus</span>
          <span className="flex items-center gap-2">
            <span className="h-px w-6 bg-accent-soft hidden sm:block" />
            private by design
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Non-interactive locked-feature row. Deliberately a <li>, not a link —
 * nothing here may look tappable while PRE_LAUNCH.
 */
function LockedRow({ name, note }: { name: string; note: string }) {
  return (
    <li className="flex min-h-[44px] items-center justify-between gap-4 border-b border-accent-soft py-2.5 last:border-0">
      <span className="text-[14px] tracking-[0.04em] text-ink-soft lowercase">{name}</span>
      <span className="shrink-0 text-[11px] tracking-[0.14em] uppercase text-ink-faint">{note}</span>
    </li>
  );
}


