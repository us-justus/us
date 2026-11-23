"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { AccountDrawer } from "./account-drawer";
import { BottomNav } from "./bottom-nav";
import { PrelaunchHomeProvider } from "./prelaunch-home-context";
import type { NavSnapshot } from "./nav-state";
import { initialNavSnapshot } from "./nav-state";

/**
 * Minimal shared top header. It contains ONLY:
 *
 *   us
 *
 * Discover/search/matches/profile/settings live in the bottom navigation;
 * the old desktop pill nav and hamburger menu are gone on every viewport.
 */
function TopHeader({ snapshot, pathname, prelaunchHome }: { snapshot: NavSnapshot; pathname: string; prelaunchHome: boolean }) {
  return (
    <header className={cn("sticky top-0 z-40 border-b border-line backdrop-blur-[8px]", prelaunchHome ? "bg-paper-2/90" : "bg-paper/80")}>
      {/* Compact mobile app header (52px): wordmark centered. 44px touch
          targets preserved; no pill, no extra vertical padding. */}
      <div className="relative mx-auto flex h-[52px] max-w-[1080px] items-center justify-end px-4 sm:h-[56px] sm:px-8">
        <Link href={snapshot.status === "product" ? "/home" : "/"} className="absolute left-1/2 flex min-h-[44px] -translate-x-1/2 items-center" aria-label="us home">
          <Wordmark size="sm" />
        </Link>

        {snapshot.status === "product" ? <div className="flex items-center">
          {pathname === "/profile"
            // Settings gear lives IN the sticky header row (in-flow), never
            // as a viewport-fixed overlay: one sticky unit (wordmark + gear
            // + background + border) stays stationary on iPhone Safari while
            // only the page content below scrolls. Exclusive to /profile —
            // /home and every other route render nothing here.
            ? <AccountDrawer avatarUrl={snapshot.primaryAvatarUrl} />
            : null}
        </div> : snapshot.status === "onboarding" ? (
          <p className="px-1 text-[11px] tracking-[0.18em] uppercase text-ink-faint">joining campus</p>
        ) : snapshot.status === "public" ? (
          <nav className="flex items-center gap-2" aria-label="public">
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
        ) : null}
      </div>
    </header>
  );
}

/**
 * Shared navigation chrome (see src/lib/auth/product-state.ts for the model).
 *
 * Viewport shell — one flex column:
 *
 *   top header (sticky, in-flow)
 *   page content (main, flex-1 — passed as children)
 *   bottom nav (sticky bottom, in-flow — reserves its own space)
 *
 * The shell is always `min-h-dvh` and the document scrolls normally. No
 * route sniffing, no viewport locks, no overflow manipulation: pages own
 * their own bounds (the chat conversation is a self-bounding `h-[100dvh]`
 * column with its own sticky composer, exactly the last-known-good
 * architecture). The bottom nav is sticky rather than fixed, so page
 * content naturally ends above it on every route where it renders.
 * Safe-area ownership: the bottom nav pads env(safe-area-inset-bottom)
 * on routes where it renders; the chat conversation renders no bottom
 * nav (see below) so its sticky composer owns the inset there instead —
 * the inset is never padded twice on any route.
 *
 * - PUBLIC (no session): `us` + log in + enter. Never product nav.
 * - LOGIN / AUTH (`/login`, `/auth/*`): minimal centered `us` only. The page
 *   IS the auth experience, so public landing CTAs (log in + enter) are never
 *   shown here — and product chrome (bottom nav, settings) never leaks into
 *   credential/recovery flows either.
 * - ONBOARDING (session, step != complete, or any /onboarding route):
 *   minimal `us` only. Never product nav, never account-security messaging.
 * - PRODUCT (campus anonymous-complete OR permanent): minimal top header
 *   + bottom primary nav (home, search, profile).
 *
 * Exactly one /api/account/state resolution per navigation, owned by this
 * chrome and shared by the top header and the bottom nav. Supabase
 * `is_anonymous` is never consulted directly — the server decides.
 * Defaults to public/minimal while resolving so a logged-out visitor never
 * sees a flash of authenticated navigation.
 *
 * Ownership rule (perf slice 2): this chrome is the ONLY ambient resolver.
 * Product pages never re-resolve account state for guard purposes — the
 * server page guard (`getProductSession()`/`guardProductSession()`) already
 * ran, and page-specific payloads (e.g. /api/profile 401) surface auth
 * failures themselves. Post-mutation fresh reads (password set,
 * verify-continue) stay with the mutating page — they are intentional,
 * not duplicates.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<NavSnapshot>(initialNavSnapshot);

  const isOnboardingRoute = pathname.startsWith("/onboarding");
  // Login + auth-callback/recovery flows own their auth UI. They always get
  // the minimal centered-`us` header: never the public landing CTAs (a second
  // LOG IN + ENTER on the login page itself), never product chrome (bottom
  // nav / settings) even when a session already exists.
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/auth/");
  const isLanding = pathname === "/";
  const isInsideRoute = pathname === "/inside" || pathname.startsWith("/inside/");

  // Onboarding/auth routes force the effective snapshot (see below), so the
  // ambient resolution is skipped there — its result would be discarded.
  // The resolve refires on leaving (pathname change), and the auth + chat
  // subscriptions below stay active, so no transition is missed.
  const skipAmbientResolve = isOnboardingRoute || isAuthRoute || isInsideRoute;

  // Server (/api/account/state) remains the single decider — this only
  // re-resolves it. The chrome instance outlives client-side navigations
  // (root layout persists), and server-side auth mutations (e.g. POST
  // /api/auth/login sets cookies without touching browser localStorage) do
  // not reliably fire onAuthStateChange — so a mount-only fetch stays stuck
  // on the pre-sign-in state after ENTER/LOG IN route to /home.
  // Re-resolving on every pathname change keeps the chrome in sync.
  const resolve = useCallback(async () => {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as {
        signedIn?: unknown;
        onboardingStep?: unknown;
        unreadCount?: unknown;
        primaryAvatarUrl?: unknown;
        chatUnread?: unknown;
      } | null;
      if (!j?.signedIn) {
        setSnapshot({ status: "public", unread: 0, primaryAvatarUrl: null, chatUnread: false });
        return;
      }
      setSnapshot({
        status: j.onboardingStep === "complete" ? "product" : "onboarding",
        unread: typeof j.unreadCount === "number" && j.unreadCount > 0 ? j.unreadCount : 0,
        primaryAvatarUrl: typeof j.primaryAvatarUrl === "string" ? j.primaryAvatarUrl : null,
        chatUnread: j.chatUnread === true,
      });
    } catch {
      setSnapshot({ status: "public", unread: 0, primaryAvatarUrl: null, chatUnread: false });
    }
  }, []);

  useEffect(() => {
    // The public landing page is effectively static from the chrome's
    // perspective: it renders no chrome, so it performs no account-state
    // resolution either. Onboarding/auth routes likewise discard the
    // snapshot (forced minimal status below) — skip the fetch; leaving the
    // route re-resolves.
    if (isLanding || skipAmbientResolve) return;
    // Chrome state is external server truth (/api/account/state), not derived
    // render state — re-sync it on every navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolve();
  }, [resolve, pathname, isLanding, skipAmbientResolve]);

  useEffect(() => {
    // No auth-driven chrome behavior on the public landing page.
    if (isLanding || isInsideRoute) return;
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [resolve, isLanding, isInsideRoute]);

  // Chat activity elsewhere (the /chat inbox listener, the open
  // conversation island) re-resolves the same server truth so the 💬 dot
  // appears/clears live. No payload crosses this boundary — it is only a
  // "re-check" signal, never message content.
  useEffect(() => {
    // No account-state-driven subscriptions on the public landing page.
    if (isLanding || isInsideRoute) return;
    const onChatActivity = () => {
      void resolve();
    };
    window.addEventListener("us:chat-activity", onChatActivity);
    return () => window.removeEventListener("us:chat-activity", onChatActivity);
  }, [resolve, isLanding, isInsideRoute]);

  // Onboarding routes are always minimal, even before the session resolves —
  // the USN page must never show product navigation. Login/auth routes are
  // likewise always minimal (`loading` renders the centered wordmark with no
  // right-side content): /login must never show the public LOG IN + ENTER it
  // duplicates, and /auth/* recovery/verify flows must never inherit product
  // chrome from an existing session.
  const effective: NavSnapshot = isOnboardingRoute
    ? { ...snapshot, status: "onboarding" }
    : isAuthRoute
      ? { ...snapshot, status: "loading" }
      : snapshot;

  if (isInsideRoute) return <>{children}</>;
  const prelaunchHome = pathname === "/home" && effective.status === "product";

  // The public landing hero owns its wordmark and its two actions. Keep the
  // page content unchromed for non-product sessions on landing.
  if (isLanding) return <>{children}</>;

  // A conversation is exactly /chat/<matchId> (the /chat inbox itself keeps
  // normal document scroll). Scoped narrowly so no other route is affected.
  const isChatConversation = /^\/chat\/[^/]+\/?$/.test(pathname);

  // Bottom nav is product-only: public/onboarding/loading see no bar
  // (and therefore reserve no space for one). It is also hidden on a chat
  // conversation (`/chat/[matchId]`): that route is a self-bounding
  // `h-[100dvh]` column with its own sticky composer (last-known-good
  // architecture), and an in-flow bar underneath it would push the
  // composer below the fold and turn the whole page into the scroller.
  // The conversation keeps its own back navigation + the top header.
  const showBottomNav = effective.status === "product" && !isChatConversation;

  return (
    <PrelaunchHomeProvider active={prelaunchHome}>
      <div className="flex min-h-dvh flex-col">
        <TopHeader snapshot={effective} pathname={pathname} prelaunchHome={prelaunchHome} />
        {children}
        {showBottomNav && <BottomNav snapshot={effective} pathname={pathname} prelaunchHome={prelaunchHome} />}
      </div>
    </PrelaunchHomeProvider>
  );
}

/** Back-compat alias — the root layout now prefers SiteChrome. */
export const SiteHeader = SiteChrome;
