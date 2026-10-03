"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "./bottom-nav";
import type { NavSnapshot } from "./nav-state";
import { initialNavSnapshot, isActiveLink } from "./nav-state";

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/**
 * Minimal shared top header. It contains ONLY:
 *
 *   us                                      chat   notifications
 *
 * Discover/search/matches/profile/settings live in the bottom navigation;
 * the old desktop pill nav and hamburger menu are gone on every viewport.
 * Chat + notifications appear only for completed product sessions once
 * launched (both stay server-locked pre-launch — no dead links offered).
 */
function TopHeader({ snapshot, pathname }: { snapshot: NavSnapshot; pathname: string }) {
  const showActivity = snapshot.status === "product" && snapshot.launched;
  const unread = snapshot.unread;
  const chatUnread = snapshot.chatUnread === true;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-[8px]">
      {/* Compact mobile app header (52px): wordmark left, chat +
          notifications right. 44px touch targets preserved; no pill, no
          extra vertical padding. */}
      <div className="mx-auto flex h-[52px] max-w-[1080px] items-center justify-between px-4 sm:h-[56px] sm:px-8">
        <Link href="/" className="flex min-h-[44px] items-center" aria-label="us home">
          <Wordmark size="sm" />
        </Link>

        {showActivity ? (
          <nav className="flex items-center gap-1" aria-label="activity">
            <Link
              href="/chat"
              aria-label={chatUnread ? "chat, unread messages" : "chat"}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                isActiveLink(pathname, "/chat")
                  ? "text-accent-deep bg-accent-wash"
                  : "text-ink-soft hover:text-accent-deep hover:bg-accent-wash",
              )}
            >
              <span className="relative inline-flex items-center justify-center">
                <ChatIcon />
                {chatUnread && (
                  <span aria-hidden className="absolute -right-[5px] -top-[2px] h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </span>
            </Link>
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `notifications, ${unread} unread` : "notifications"}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                isActiveLink(pathname, "/notifications")
                  ? "text-accent-deep bg-accent-wash"
                  : "text-ink-soft hover:text-accent-deep hover:bg-accent-wash",
              )}
            >
              <span className="relative inline-flex items-center justify-center">
                <BellIcon />
                {unread > 0 && (
                  <span aria-hidden className="absolute -right-[5px] -top-[2px] h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </span>
            </Link>
          </nav>
        ) : snapshot.status === "onboarding" ? (
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
 * - ONBOARDING (session, step != complete, or any /onboarding route):
 *   minimal `us` only. Never product nav, never account-security messaging.
 * - PRODUCT (campus anonymous-complete OR permanent): minimal top header
 *   (activity icons once launched) + bottom primary nav (all four items once
 *   launched; search + profile only while PRE_LAUNCH, since Discover/Matches/
 *   Chat stay server-locked — no links offered).
 *
 * Exactly one /api/account/state resolution per navigation, shared by the
 * top header and the bottom nav. Supabase `is_anonymous` is never consulted
 * directly — the server decides. Defaults to public/minimal while resolving
 * so a logged-out visitor never sees a flash of authenticated navigation.
 */
/**
 * Live chat-activity listener — header-level tripwire only.
 *
 * Subscribes with one filtered `match_id=eq.<id>` binding per known match
 * (the same filtered pattern as the conversation/inbox subscriptions — never
 * a global unfiltered subscription, never polling, never setInterval).
 * Payload content is never read or rendered; an INSERT is only a signal to
 * re-resolve /api/account/state, where the server re-derives the dot from
 * match membership + latest messages + read cursors. Cleans up on unmount /
 * match-set change, mirroring the inbox listener.
 */
function ChatActivityListener({
  matchIds,
  enabled,
  onActivity,
}: {
  matchIds: string[];
  enabled: boolean;
  onActivity: () => void;
}) {
  const key = matchIds.join(",");

  useEffect(() => {
    if (!enabled) return;
    const ids = key.split(",").filter(Boolean);
    if (!ids.length) return;
    const allowed = new Set(ids);
    const supabase = createClient();
    const channel = supabase.channel("chat:activity");
    for (const id of ids) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${id}` },
        (payload) => {
          const matchId = (payload.new as { match_id?: string } | null)?.match_id;
          if (typeof matchId === "string" && allowed.has(matchId)) {
            onActivity();
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, key, onActivity]);

  return null;
}

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<NavSnapshot>(initialNavSnapshot);
  // Match IDs the header activity listener scopes itself to. Resolved with
  // the same /api/account/state fetch (no extra request); match IDs only,
  // never user IDs or message content.
  const [chatMatchIds, setChatMatchIds] = useState<string[]>([]);

  const isOnboardingRoute = pathname.startsWith("/onboarding");
  const isLanding = pathname === "/";

  // Server (/api/account/state) remains the single decider — this only
  // re-resolves it. The chrome instance outlives client-side navigations
  // (root layout persists), and server-side auth mutations (e.g. POST
  // /api/auth/login sets cookies without touching browser localStorage) do
  // not reliably fire onAuthStateChange — so a mount-only fetch stays stuck
  // on the pre-sign-in state after ENTER/LOG IN route to /discover.
  // Re-resolving on every pathname change keeps the chrome in sync.
  const resolve = useCallback(async () => {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!j?.signedIn) {
        setSnapshot({ status: "public", launched: false, unread: 0, primaryAvatarUrl: null, chatUnread: false });
        setChatMatchIds([]);
        return;
      }
      setSnapshot({
        status: j.onboardingStep === "complete" ? "product" : "onboarding",
        launched: j.launched === true,
        unread: typeof j.unreadCount === "number" && j.unreadCount > 0 ? j.unreadCount : 0,
        primaryAvatarUrl: typeof j.primaryAvatarUrl === "string" ? j.primaryAvatarUrl : null,
        chatUnread: j.chatUnread === true,
      });
      setChatMatchIds(Array.isArray(j.chatMatchIds) ? j.chatMatchIds.filter((id: unknown) => typeof id === "string") : []);
    } catch {
      setSnapshot({ status: "public", launched: false, unread: 0, primaryAvatarUrl: null, chatUnread: false });
      setChatMatchIds([]);
    }
  }, []);

  useEffect(() => {
    // Chrome state is external server truth (/api/account/state), not derived
    // render state — re-sync it on every navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolve();
  }, [resolve, pathname]);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [resolve]);

  // Chat activity elsewhere (the /chat inbox listener, the open
  // conversation island) re-resolves the same server truth so the 💬 dot
  // appears/clears live. No payload crosses this boundary — it is only a
  // "re-check" signal, never message content.
  useEffect(() => {
    const onChatActivity = () => {
      void resolve();
    };
    window.addEventListener("us:chat-activity", onChatActivity);
    return () => window.removeEventListener("us:chat-activity", onChatActivity);
  }, [resolve]);

  // Onboarding routes are always minimal, even before the session resolves —
  // the USN page must never show product navigation.
  const effective: NavSnapshot = isOnboardingRoute ? { ...snapshot, status: "onboarding" } : snapshot;

  // The public landing hero owns its wordmark and its two actions. Keep the
  // page content unchromed for non-product sessions on landing.
  if (isLanding && effective.status !== "product") return <>{children}</>;

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

  const showChatActivity = effective.status === "product" && effective.launched;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopHeader snapshot={effective} pathname={pathname} />
      {showChatActivity && (
        <ChatActivityListener matchIds={chatMatchIds} enabled={showChatActivity} onActivity={resolve} />
      )}
      {children}
      {showBottomNav && <BottomNav snapshot={effective} pathname={pathname} />}
    </div>
  );
}

/** Back-compat alias — the root layout now prefers SiteChrome. */
export const SiteHeader = SiteChrome;
