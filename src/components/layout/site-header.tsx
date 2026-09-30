"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";

const productLinks = [
  { href: "/discover", label: "discover" },
  { href: "/search", label: "search" },
  { href: "/matches", label: "matches" },
  { href: "/chat", label: "chat" },
  { href: "/profile", label: "profile" },
  { href: "/settings", label: "settings" },
];

/**
 * PRE_LAUNCH nav (STEP 3A/3B): completed sessions while `launched = false`
 * see only home + search + identity/account destinations. Discover/matches/chat
 * stay server-locked, so they are not offered as navigation.
 */
const prelaunchLinks = [
  { href: "/", label: "home" },
  { href: "/search", label: "search" },
  { href: "/profile", label: "profile" },
  { href: "/settings", label: "settings" },
];

type HeaderState = "loading" | "public" | "onboarding" | "product";

/**
 * Product-state header (see src/lib/auth/product-state.ts for the model).
 *
 * - PUBLIC (no session): `us` + log in + enter. Never product nav.
 * - ONBOARDING (session, step != complete, or any /onboarding route):
 *   minimal `us` only. Never product nav, never account-security messaging.
 * - PRODUCT (campus anonymous-complete OR permanent): full product nav
 *   once launched; minimal home/search/profile/settings nav while PRE_LAUNCH
 *   (Discover/Matches/Chat stay server-locked — no links offered).
 *
 * Defaults to public/minimal while resolving so a logged-out visitor never
 * sees a flash of authenticated navigation. Supabase `is_anonymous` is never
 * consulted directly — the server (/api/account/state) decides the step.
 * That endpoint also returns the server-authoritative `launched` flag, which
 * only switches which product links are offered (never authorization).
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [headerState, setHeaderState] = useState<HeaderState>("loading");
  const [launched, setLaunched] = useState(false);

  const isOnboardingRoute = pathname.startsWith("/onboarding");
  const isLanding = pathname === "/";

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const res = await fetch("/api/account/state", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!j?.signedIn) {
          setHeaderState("public");
          return;
        }
        setHeaderState(j.onboardingStep === "complete" ? "product" : "onboarding");
        setLaunched(j.launched === true);
      } catch {
        if (!cancelled) setHeaderState("public");
      }
    }
    void resolve();
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Onboarding routes are always minimal, even before the session resolves —
  // the USN page must never show product navigation.
  const effective: HeaderState = isOnboardingRoute ? "onboarding" : headerState;
  const showProductNav = effective === "product";
  // PRE_LAUNCH offers only home/search/profile/settings; the full dating nav
  // returns once the server reports launched = true.
  const visibleLinks = launched ? productLinks : prelaunchLinks;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b",
        isLanding
          ? "bg-accent-wash/80 backdrop-blur-[8px] border-transparent"
          : "bg-paper/80 backdrop-blur-[8px] border-line",
      )}
    >
      <div className="mx-auto max-w-[1080px] px-6 sm:px-8 flex h-[56px] items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="us home">
          <Wordmark size="sm" />
        </Link>

        {/* desktop */}
        {showProductNav ? (
          <nav className="hidden sm:flex items-center gap-1" aria-label="product">
            {visibleLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "inline-flex min-h-[44px] items-center px-3 py-1.5 text-[13px] tracking-[0.08em] lowercase rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  pathname === l.href ? "text-accent-deep bg-accent-wash" : "text-ink-soft hover:text-accent-deep hover:bg-accent-wash",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        ) : effective === "onboarding" ? (
          <nav className="hidden sm:flex items-center gap-1" aria-label="onboarding">
            <span className="px-3 py-1.5 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
              joining campus
            </span>
          </nav>
        ) : (
          <nav className="hidden sm:flex items-center gap-2" aria-label="public">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              log in
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 py-2 text-[12px] tracking-[0.14em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              enter
            </Link>
          </nav>
        )}

        {/* mobile toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="toggle menu"
          className="sm:hidden inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="relative block h-3 w-3.5">
            <span
              className={cn(
                "absolute left-0 top-0 h-px w-full bg-ink transition-transform",
                open && "translate-y-[5px] rotate-45",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[5px] h-px w-full bg-ink transition-opacity",
                open && "opacity-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[10px] h-px w-full bg-ink transition-transform",
                open && "-translate-y-[5px] -rotate-45",
              )}
            />
          </span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            // Absolute overlay: opening the menu must not push page content
            // down (layout shift) or move the dismiss target mid-tap.
            className="absolute inset-x-0 top-full border-b border-line bg-paper shadow-[0_16px_32px_rgba(23,22,20,0.08)] sm:hidden"
          >
            <nav className="px-6 py-5 flex flex-col gap-1" aria-label="mobile">
              {showProductNav ? (
                <>
                  {visibleLinks.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "inline-flex min-h-[44px] items-center py-2.5 text-[14px] tracking-[0.08em] lowercase border-b border-line last:border-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        pathname === l.href ? "text-accent-deep bg-accent-wash" : "text-ink-soft hover:text-accent-deep",
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </>
              ) : effective === "onboarding" ? (
                <p className="py-2.5 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
                  joining campus — finish setup to enter
                </p>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="inline-flex min-h-[44px] items-center py-2.5 text-[14px] tracking-[0.08em] lowercase border-b border-line text-ink-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    log in
                  </Link>
                  <Link
                    href="/onboarding"
                    onClick={() => setOpen(false)}
                    className="mt-3 inline-flex min-h-[44px] justify-center items-center rounded-full bg-ink px-6 py-3 text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    enter the campus
                  </Link>
                  <p className="mt-3 text-center text-[11px] tracking-[0.08em] text-ink-faint">
                    new here? enter · have an account? log in
                  </p>
                </>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
