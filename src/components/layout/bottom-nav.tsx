"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { NavSnapshot } from "./nav-state";
import { isActiveLink } from "./nav-state";

function HeartIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  );
}

/**
 * Primary product navigation — mobile-first bottom bar.
 *
 * Fixed order (mandatory): matches → discover → search → profile.
 * Discover carries slightly stronger inactive emphasis (ink vs ink-soft)
 * as the primary surface — no CTA styling, no gradients, no shadows.
 * Active state is a quiet accent-deep tint + tiny coral dot.
 *
 * Layout contract: the bar is the last in-flow child of the SiteChrome
 * shell (`sticky bottom-0`), never `fixed`. It reserves its own physical
 * footprint, so page content — including the chat composer — naturally ends
 * above it and no page needs viewport arithmetic or spacers. This component
 * is the sole owner of `env(safe-area-inset-bottom)` in the shell; pages
 * must not pad the same inset again.
 *
 * Rendered only for completed product sessions (see SiteChrome). While
 * PRE_LAUNCH, matches/discover stay server-locked so only search + profile
 * are offered — order preserved. /settings* activates the profile item.
 */
export function BottomNav({ snapshot, pathname }: { snapshot: NavSnapshot; pathname: string }) {
  if (snapshot.status !== "product") return null;
  const launched = snapshot.launched;
  const profileActive = isActiveLink(pathname, "/profile") || isActiveLink(pathname, "/settings");

  return (
    <nav
      aria-label="primary"
      className="sticky bottom-0 z-40 border-t border-line bg-paper/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className={cn("mx-auto grid w-full max-w-[420px] px-2", launched ? "grid-cols-4" : "grid-cols-2")}>
        {launched && (
          <Link
            href="/matches"
            aria-label="Matches"
            title="Matches"
            aria-current={isActiveLink(pathname, "/matches") ? "page" : undefined}
            className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:min-h-[4.25rem]"
          >
            <span className={cn(isActiveLink(pathname, "/matches") ? "text-accent-deep" : "text-ink-soft")}>
              <HeartIcon />
            </span>
            <span aria-hidden className={cn("hidden text-[10px] tracking-[0.08em] lowercase sm:block", isActiveLink(pathname, "/matches") ? "text-accent-deep" : "text-ink-faint")}>
              matches
            </span>
            <span aria-hidden className={cn("h-1 w-1 rounded-full", isActiveLink(pathname, "/matches") ? "bg-accent" : "bg-transparent")} />
          </Link>
        )}
        {launched && (
          <Link
            href="/discover"
            aria-label="Discover"
            title="Discover"
            aria-current={isActiveLink(pathname, "/discover") ? "page" : undefined}
            className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:min-h-[4.25rem]"
          >
            <span className={cn(isActiveLink(pathname, "/discover") ? "text-accent-deep" : "text-ink")}>
              <SparkIcon />
            </span>
            <span aria-hidden className={cn("hidden text-[10px] tracking-[0.08em] lowercase sm:block", isActiveLink(pathname, "/discover") ? "text-accent-deep" : "text-ink-soft")}>
              discover
            </span>
            <span aria-hidden className={cn("h-1 w-1 rounded-full", isActiveLink(pathname, "/discover") ? "bg-accent" : "bg-transparent")} />
          </Link>
        )}
        <Link
          href="/search"
          aria-label="Search"
          title="Search"
          aria-current={isActiveLink(pathname, "/search") ? "page" : undefined}
          className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:min-h-[4.25rem]"
        >
          <span className={cn(isActiveLink(pathname, "/search") ? "text-accent-deep" : "text-ink-soft")}>
            <SearchIcon />
          </span>
          <span aria-hidden className={cn("hidden text-[10px] tracking-[0.08em] lowercase sm:block", isActiveLink(pathname, "/search") ? "text-accent-deep" : "text-ink-faint")}>
            search
          </span>
          <span aria-hidden className={cn("h-1 w-1 rounded-full", isActiveLink(pathname, "/search") ? "bg-accent" : "bg-transparent")} />
        </Link>
        <Link
          href="/profile"
          aria-label="Profile"
          title="Profile"
          aria-current={profileActive ? "page" : undefined}
          className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:min-h-[4.25rem]"
        >
          <span
            className={cn(
              "inline-flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded-full border",
              profileActive ? "border-accent-soft" : "border-transparent",
            )}
          >
            {snapshot.primaryAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={snapshot.primaryAvatarUrl}
                alt=""
                width={22}
                height={22}
                loading="lazy"
                decoding="async"
                className="h-[22px] w-[22px] object-cover"
              />
            ) : (
              <span className={cn(profileActive ? "text-accent-deep" : "text-ink-soft")}>
                <PersonIcon />
              </span>
            )}
          </span>
          <span aria-hidden className={cn("hidden text-[10px] tracking-[0.08em] lowercase sm:block", profileActive ? "text-accent-deep" : "text-ink-faint")}>
            profile
          </span>
          <span aria-hidden className={cn("h-1 w-1 rounded-full", profileActive ? "bg-accent" : "bg-transparent")} />
        </Link>
      </div>
    </nav>
  );
}
