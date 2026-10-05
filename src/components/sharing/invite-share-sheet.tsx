"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InviteShareCard } from "@/components/sharing/invite-share-card";
import {
  absolutizeUrl,
  copyTextWithFallbacks,
  detectShareSupport,
  inviteShareText,
  inviteShareTitle,
} from "@/components/sharing/share-button";
import {
  generateInviteCardImage,
  inviteCardFileName,
} from "@/components/sharing/share-card-image";

type SheetStatus =
  | "idle"
  | "working"
  | "ready"
  | "unavailable"
  | "copied"
  | "manual"
  | "error";

/**
 * Minimal invite share sheet (presentation only).
 *
 * Bottom sheet on mobile, centered compact dialog on desktop. Does not
 * navigate. Attribution unchanged: the absolute /invite/<token> URL from
 * the existing /api/invite stays the single mechanism; no token is shown
 * prominently and none is rendered into the card image.
 *
 * The stable invite URL is fetched lazily on first Share/Copy tap (cached
 * after) — never on page render, never just to show the preview.
 *
 * Mobile behavior: the outer box is pinned to exactly the visible
 * viewport (`inset-x-0 top-0 h-[100dvh]` — anchored at the viewport top
 * with an explicit dynamic-viewport height, so no edge extends behind
 * Safari's bottom toolbar). The previous `fixed inset-0` relied on the
 * browser to resolve the over-constrained top + height + bottom triple,
 * which let the bottom-anchored panel bleed into the browser area on
 * mobile. The panel is content-sized with an explicit
 * `max-sm:max-h-[100dvh]` guard plus safe-area bottom padding, sized to
 * fit without scrolling; `overflow-y-auto` remains only as a safety valve
 * for transient states (error/manual-link). The page behind cannot
 * scroll (body overflow lock).
 *
 * Stacking: portaled to document.body so `z-50` competes at the root
 * level — above the sticky bottom nav (z-40). Without the portal,
 * ancestors such as the pre-launch panel's `isolate` trap the sheet
 * in a local stacking context and Search/Profile paint over it.
 *
 * Fallback order (LAN-safe): COPY LINK is the only path that copies
 * (Clipboard API → legacy execCommand → manual readonly field). SHARE only
 * invokes navigator.share() and never falls through to copying.
 */
export function InviteShareSheet({
  username,
  spot,
  open,
  onClose,
}: {
  username: string;
  spot: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<SheetStatus>("idle");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const workingRef = useRef(false);

  // Escape to close + initial focus on the close button.
  // No state writes here — pure external-system sync.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scroll while open (restored on close).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open ]);

  const handleClose = useCallback(() => {
    // Keep the cached URL (stable one-per-inviter) but drop transient
    // result messaging so a reopen starts from a clean preview.
    setStatus((s) =>
      s === "unavailable" || s === "copied" || s === "manual" || s === "error"
        ? inviteUrl
          ? "ready"
          : "idle"
        : s,
    );
    setErrorMsg(null);
    onClose();
  }, [inviteUrl, onClose]);

  /** Fetch (and cache) the stable absolute invite URL. */
  const ensureInviteUrl = useCallback(async (): Promise<string> => {
    if (inviteUrl) return inviteUrl;
    const res = await fetch("/api/invite", { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.inviteUrl) {
      throw new Error(j?.error || "Could not create invite.");
    }
    const absolute = absolutizeUrl(j.inviteUrl as string);
    setInviteUrl(absolute);
    return absolute;
  }, [inviteUrl]);

  const handleShare = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    setStatus("working");
    setErrorMsg(null);
    try {
      const url = await ensureInviteUrl();
      const title = inviteShareTitle();
      const text = inviteShareText(spot);
      const { share, fileShare } = detectShareSupport();

      // SHARE must never silently copy. When native share is unavailable,
      // show the fallback state and leave COPY LINK as the explicit
      // alternative.
      if (!share) {
        setStatus("unavailable");
        return;
      }

      // Prefer file share (card image) where supported; fall back to
      // URL/text share. Image sharing is optional — never a prerequisite
      // for opening the native sheet. Never fall through to copying.
      if (fileShare) {
        try {
          const blob = await generateInviteCardImage({ username, spot });
          const file = new File([blob], inviteCardFileName(username), {
            type: "image/png",
          });
          await navigator.share({ files: [file], title, text, url });
          // Success or cancel both return to the normal card UI.
          setStatus("ready");
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            setStatus("ready");
            return;
          }
          // Fall through to URL/text share.
        }
      }
      try {
        await navigator.share({ title, text, url });
        setStatus("ready");
        return;
      } catch (err) {
        // User cancellation is normal — no error, no copy.
        if (err instanceof Error && err.name === "AbortError") {
          setStatus("ready");
          return;
        }
        // Unexpected share errors surface the unavailable state.
        // Never copy, never expose raw browser errors.
        setStatus("unavailable");
        return;
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not create invite.");
      setStatus("error");
    } finally {
      workingRef.current = false;
    }
  }, [ensureInviteUrl, spot, username]);

  const handleCopy = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    setStatus("working");
    setErrorMsg(null);
    try {
      const url = await ensureInviteUrl();
      const outcome = await copyTextWithFallbacks(url);
      setStatus(outcome === "copied" ? "copied" : "manual");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not create invite.");
      setStatus("error");
    } finally {
      workingRef.current = false;
    }
  }, [ensureInviteUrl]);

  if (!open) return null;

  const busy = status === "working";
  const canAct = !busy;

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share your spot"
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center sm:inset-0 sm:h-auto sm:items-center sm:p-6"
    >
      {/* Backdrop — tap to dismiss. Covers the full box so Search/Profile
          underneath are dimmed and not interactable while open. */}
      <button
        aria-label="Close share dialog"
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-black/30"
      />
      <div className="relative flex w-full max-w-[340px] flex-col overscroll-contain rounded-t-[24px] border border-line bg-paper px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:max-h-[100dvh] max-sm:overflow-y-auto sm:rounded-[24px] sm:pt-5 sm:pb-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="flex min-h-[44px] items-center font-display text-[22px] tracking-[-0.02em] text-ink">
            share your spot
          </h2>
          <button
            ref={closeRef}
            onClick={handleClose}
            aria-label="Close"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-line text-[16px] text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ×
          </button>
        </div>

        <div className="mt-2 sm:mt-3">
          {busy ? (
            <div
              aria-hidden
              className="mx-auto flex aspect-[4/5] w-[62%] max-w-[180px] items-center justify-center rounded-[20px] border border-line bg-paper-2 sm:aspect-[3/4] sm:w-[72%] sm:max-w-[240px]"
            >
              <p className="text-[11px] tracking-[0.16em] uppercase text-ink-faint">
                sharing…
              </p>
            </div>
          ) : (
            <InviteShareCard username={username} spot={spot} />
          )}
        </div>

        {status === "error" && errorMsg && (
          <p role="alert" className="mt-3 text-center text-[11px] tracking-[0.12em] uppercase text-accent-deep">
            {errorMsg}
          </p>
        )}
        {status === "unavailable" && (
          <p role="status" className="mt-3 text-center text-[11px] tracking-[0.12em] uppercase text-ink-faint">
            sharing isn&apos;t available here
          </p>
        )}
        {status === "copied" && (
          <p className="mt-3 text-center text-[11px] tracking-[0.12em] uppercase text-ink-faint">
            link copied
          </p>
        )}
        {status === "manual" && inviteUrl && (
          <div className="mt-3">
            <p className="text-center text-[11px] tracking-[0.12em] uppercase text-ink-faint">
              copy your link manually
            </p>
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.currentTarget.select()}
              aria-label="Your invite link"
              className="mt-2 min-h-[44px] w-full rounded-2xl border border-line bg-paper px-4 py-[13px] text-center text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2.5 sm:mt-4 sm:gap-2">
          <button
            onClick={handleShare}
            disabled={!canAct}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-3 text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 sm:py-[14px]"
          >
            {busy ? "sharing…" : "share"}
          </button>
          <button
            onClick={handleCopy}
            disabled={!canAct}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-3 text-[12px] tracking-[0.16em] uppercase font-medium text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 sm:py-[13px]"
          >
            copy link
          </button>
        </div>
      </div>
    </div>
  );

  // Portal out of the page's stacking contexts (e.g. the pre-launch
  // panel's `isolate`) so the fixed overlay + backdrop truly cover the
  // sticky bottom nav. `open` is only ever set from a client tap, so
  // document exists here; guard anyway for SSR safety.
  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}
