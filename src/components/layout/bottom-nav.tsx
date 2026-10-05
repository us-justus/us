"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { NavSnapshot } from "./nav-state";
import { isActiveLink } from "./nav-state";

function SearchIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/**
 * Primary product navigation — mobile-first bottom bar, icon-only at all
 * breakpoints.
 *
 * Fixed order (mandatory): matches → discover → search → profile.
 * Discover carries slightly stronger inactive emphasis (ink vs ink-soft)
 * as the primary surface — no CTA styling, no gradients, no shadows.
 * Active state is a quiet accent-deep tint + tiny coral dot.
 * No text labels are rendered.
 *
 * Layout contract: the bar is the last in-flow child of the SiteChrome
 * shell (`sticky bottom-0`), never `fixed`. It reserves its own physical
 * footprint, so page content — including the chat composer — naturally ends
 * above it and no page needs viewport arithmetic or spacers. This component
 * is the sole owner of `env(safe-area-inset-bottom)` in the shell; pages
 * must not pad the same inset again.
 *
 * Rendered only for completed product sessions (see SiteChrome). The waiting
 * experience offers home + search + profile — order preserved.
 * /settings* activates the profile item.
 */
export function BottomNav({ snapshot, pathname, prelaunchHome = false }: { snapshot: NavSnapshot; pathname: string; prelaunchHome?: boolean }) {
  if (snapshot.status !== "product") return null;
  const profileActive = isActiveLink(pathname, "/profile") || isActiveLink(pathname, "/settings");

  return (
    <nav
      aria-label="primary"
      className={cn("sticky bottom-0 z-40 border-t border-line", prelaunchHome ? "bg-paper-2/95" : "bg-paper/95")}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className={cn("mx-auto grid w-full max-w-[420px] px-2", "grid-cols-3")}>
        <Link
          href="/home"
          aria-label="Home"
          title="Home"
          aria-current={pathname === "/home" ? "page" : undefined}
          className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <span className={cn(pathname === "/home" ? "text-accent-deep" : "text-ink-soft")} aria-hidden><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg></span>
        </Link>
        <Link
          href="/search"
          aria-label="Search"
          title="Search"
          aria-current={isActiveLink(pathname, "/search") ? "page" : undefined}
          className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <span className={cn(isActiveLink(pathname, "/search") ? "text-accent-deep" : "text-ink-soft")}>
            <SearchIcon />
          </span>
          <span aria-hidden className={cn("h-1 w-1 rounded-full", isActiveLink(pathname, "/search") ? "bg-accent" : "bg-transparent")} />
        </Link>
        <Link
          href="/profile"
          aria-label="Open profile"
          title="Profile"
          aria-current={isActiveLink(pathname, "/profile") ? "page" : undefined}
          className="flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <span className={cn("inline-flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full border", profileActive ? "border-accent-soft text-accent-deep" : "border-line text-ink-soft")}>
            {snapshot.primaryAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snapshot.primaryAvatarUrl} alt="" width={26} height={26} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.4 3.1-5 7-5s6.2 1.6 7 5"/></svg>}
          </span>
          <span aria-hidden className={cn("h-1 w-1 rounded-full", profileActive ? "bg-accent" : "bg-transparent")} />
        </Link>
      </div>
    </nav>
  );
}
