"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { DiscoverProfile } from "@/lib/discover/types";
import { SwipeActions } from "./SwipeActions";

const SECONDARY_CELLS = [
  { column: "3", row: "1" },
  { column: "1", row: "3" },
  { column: "2", row: "3" },
  { column: "3", row: "2" },
  { column: "3", row: "3" },
];

export function PhotoConstellation({
  profile,
  onClose,
  onLike,
  onPass,
}: {
  profile: DiscoverProfile;
  onClose: () => void;
  onLike: () => void;
  onPass: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photos = profile.photos.slice(0, 6);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const orderedIndices = [primaryIndex, ...photos.map((_, index) => index).filter((index) => index !== primaryIndex)];

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      role="dialog"
      ref={panelRef}
      aria-modal="true"
      aria-label={`${profile.nickname}'s photos`}
      className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-y-auto bg-paper px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-8"
    >
      <header className="mx-auto flex min-h-11 w-full max-w-[560px] items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          discover
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close photos"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-[20px] leading-none text-ink-soft transition-colors hover:border-accent-soft hover:bg-accent-wash hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden>×</span>
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center py-3">
        {photos.length > 0 && (
          <div className="grid aspect-[0.82] max-h-[min(62svh,560px)] w-full grid-cols-3 grid-rows-3 gap-2 sm:gap-3">
            {orderedIndices.map((photoIndex, index) => {
              const url = photos[photoIndex];
              if (!url) return null;
              const primary = index === 0;
              const cell = SECONDARY_CELLS[index - 1];
              const angle = [0, 1.1, -0.8, 0.7, -1][(index - 1) % 5] ?? 0;
              return (
                <motion.button
                  key={`${photoIndex}-${url}`}
                  type="button"
                  layout={!reduceMotion}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 32 }}
                  onClick={() => setPrimaryIndex(photoIndex)}
                  aria-label={primary ? `${profile.nickname}, primary photo` : `Make ${profile.nickname}'s photo ${photoIndex + 1} primary`}
                  aria-pressed={primary}
                  className={`relative min-h-0 min-w-0 overflow-hidden rounded-[16px] border bg-paper-2 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:rounded-[24px] ${primary ? "border-line-strong shadow-[0_12px_32px_rgba(23,22,20,0.10)]" : "border-line"}`}
                  style={primary
                    ? { gridColumn: photos.length === 1 ? "1 / span 3" : "1 / span 2", gridRow: photos.length === 1 ? "1 / span 3" : "1 / span 2" }
                    : { gridColumn: cell?.column, gridRow: cell?.row, transform: reduceMotion ? undefined : `rotate(${angle}deg)` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${profile.nickname}, photo ${photoIndex + 1}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                    decoding="async"
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                  />
                  {!primary && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] border border-paper/30" />}
                </motion.button>
              );
            })}
          </div>
        )}

        <div className="mt-4 px-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">@{profile.username}</p>
          <h1 className="mt-1 font-display text-[30px] leading-none tracking-[-0.03em] text-ink sm:text-[34px]">
            {profile.nickname}, {profile.age}
          </h1>
          <p className="mt-2 text-[13px] tracking-[0.04em] text-ink-soft">{profile.branch} · {profile.year} year</p>
          {profile.bio && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">{profile.bio}</p>}
          <Link
            href={`/u/${encodeURIComponent(profile.username)}`}
            className="mt-2 inline-flex min-h-[44px] items-center text-[11px] uppercase tracking-[0.14em] text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent-deep focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            view full profile
          </Link>
        </div>

        <div className="mt-2 flex justify-center">
          <SwipeActions onPass={onPass} onLike={onLike} name={profile.nickname} />
        </div>
      </div>
    </motion.section>
  );
}
