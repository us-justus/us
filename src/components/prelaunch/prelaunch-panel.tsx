import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { InviteButton } from "@/components/prelaunch/invite-button";
import { PrelaunchHeartField } from "@/components/prelaunch/prelaunch-heart-field";
import { getWaitlistCopy } from "@/lib/prelaunch/waitlist-copy";

/** Minimal confirmation shown to completed accounts while waiting. */
export function PrelaunchPanel({ username, spot, waitlistCount }: { username: string | null; spot: number | null; waitlistCount: number | null }) {
  const claimed = username !== null && username !== "";

  return (
    <div className="relative isolate flex flex-1 flex-col bg-paper-2">
      {claimed && <PrelaunchHeartField />}
      <section className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8 sm:py-8">
        <Wordmark size="lg" />

        {claimed ? (
          <>
            <h1 className="mt-5 font-display text-[36px] leading-none tracking-[-0.03em] text-ink sm:text-[42px]">
              you&apos;re in.
            </h1>
            <p className="mt-4 font-display text-[24px] leading-none tracking-[-0.02em] text-ink-soft">
              @{username}
            </p>
            <p className="mt-2 font-display text-[46px] leading-none tracking-[-0.03em] text-ink">
              #{spot ?? "—"}
            </p>
            {waitlistCount !== null && (
              <p className="mt-4 text-[14px] leading-6 text-ink-soft">
                {getWaitlistCopy(waitlistCount)}
              </p>
            )}
            <p className="mt-5 text-[14px] leading-6 text-ink-soft">
              we&apos;ll email you when us launches.
            </p>
            <div className="mt-3">
              <InviteButton username={username} spot={spot} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-5 font-display text-[34px] leading-none tracking-[-0.03em] text-ink">
              claim your name.
            </h1>
            <p className="mt-4 text-[14px] leading-6 text-ink-soft">
              choose your username to reserve your permanent spot on campus.
            </p>
            <Link
              href="/onboarding/profile"
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-6 text-[12px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              choose your username
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
