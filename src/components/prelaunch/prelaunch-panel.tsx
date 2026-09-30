import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

/**
 * Minimal PRE_LAUNCH home (STEP 2 slice).
 *
 * Shown on `/` to campus/permanent sessions while `launched = false`
 * instead of bouncing to /discover (which redirects back here — a loop).
 * Server-gated Discover/Match/Chat stay locked; this panel only surfaces
 * the already-assigned public identity: @username + permanent #spot.
 *
 * Visual language matches the landing: blush wash field, dark editorial
 * type, ink primary CTA, coral dot accent. No dashboard, no animation
 * beyond the static layout.
 */
export function PrelaunchPanel({ username, spot }: { username: string | null; spot: number | null }) {
  const claimed = username !== null && username !== "";
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
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
              permanent — yours across logout, login, and any future name.
              discover opens at launch.
            </p>
            <div className="mt-8 flex w-full flex-col items-center gap-3">
              <Link
                href="/profile"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                view your profile
              </Link>
              <p className="text-[11px] tracking-[0.12em] uppercase text-ink-faint">
                discover · matches · chat — locked until launch
              </p>
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
