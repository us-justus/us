"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SignOutButton } from "@/components/settings/sign-out-button";

type DrawerProfile = { nickname: string; age: number; username: string | null; spot: number | null };

export function AccountDrawer({ avatarUrl }: { avatarUrl: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const [profile, setProfile] = useState<DrawerProfile | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  function open() {
    setIsOpen(true);
    void fetch("/api/profile", { cache: "no-store" }).then((res) => res.json()).then((data) => {
      if (data?.profile) setProfile(data.profile as DrawerProfile);
    }).catch(() => undefined);
  }
  function close() {
    setIsOpen(false);
  }

  useLayoutEffect(() => {
    const node = dialog.current;
    if (isOpen && node && !node.open) node.showModal();
  }, [isOpen]);

  function finishClose() {
    if (dialog.current?.open) dialog.current.close();
  }

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const restore = () => { setIsOpen(false); trigger.current?.focus(); };
    node.addEventListener("close", restore);
    return () => node.removeEventListener("close", restore);
  }, []);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    touchX.current = event.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchX.current;
    const end = event.changedTouches[0]?.clientX;
    if (start !== null && end !== undefined && end - start > 70) close();
    touchX.current = null;
  }

  const identity = profile ? `${profile.username ? `@${profile.username}` : ""}${profile.username && profile.spot !== null ? " · " : ""}${profile.spot !== null ? `spot #${profile.spot}` : ""}` : "";
  // Trigger positioning: in-flow header slot. This component is mounted
  // inside the sticky TopHeader (see site-header.tsx, /profile only), so the
  // gear sticks WITH the header row in normal document flow. It must never
  // go back to viewport-fixed: on iPhone Safari a fixed overlay is glued to
  // the visual/layout viewport while the sticky header moves with the
  // document, so toolbar collapse/expand + rubber-banding shift the two
  // apart and the gear visibly drifts. Dialog + motion below are untouched.
  return (
    <>
      <button ref={trigger} type="button" aria-label="Open settings" aria-haspopup="dialog" aria-expanded={isOpen} onClick={open} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent-wash hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2.5h5v3a7 7 0 0 1 2 1.15l2.6-1.5 2.5 4.3-2.6 1.5v2.1l2.6 1.5-2.5 4.3-2.6-1.5a7 7 0 0 1-2 1.15v3h-5v-3a7 7 0 0 1-2-1.15l-2.6 1.5-2.5-4.3 2.6-1.5v-2.1l-2.6-1.5 2.5-4.3 2.6 1.5a7 7 0 0 1 2-1.15v-3Z"/><circle cx="12" cy="12" r="2.6"/></svg>
      </button>
      <dialog ref={dialog} aria-label="Settings and account navigation" onCancel={(event) => { event.preventDefault(); close(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-transparent open:flex">
        <AnimatePresence onExitComplete={finishClose}>
          {isOpen && <motion.div key="settings-drawer" className="fixed inset-0 flex justify-end">
            <motion.button type="button" aria-label="Close account menu" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="absolute inset-0 cursor-default bg-ink/30" />
          <motion.aside role="document" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }} className="absolute inset-y-0 right-0 flex h-full w-[min(88vw,360px)] flex-col border-l border-line bg-paper px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper-2 text-ink-soft">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" width={56} height={56} className="h-full w-full object-cover" />
                ) : <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.4 3.1-5 7-5s6.2 1.6 7 5"/></svg>}
              </span>
              <div className="min-w-0 pt-1">
                <p className="font-display text-[24px] leading-none tracking-[-0.03em]">{profile ? `${profile.nickname}, ${profile.age}` : "your account"}</p>
                {identity && <p className="mt-2 truncate text-[12px] text-ink-soft">{identity}</p>}
              </div>
              <button type="button" autoFocus onClick={close} aria-label="Close account menu" className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-accent-wash hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <div className="my-6 border-t border-line" />
            <nav aria-label="Account" className="flex flex-col">
              {[["Edit profile", "/profile/edit"], ["Settings & privacy", "/settings"], ["Feedback", "/feedback"]].map(([label, href]) => (
                <Link key={href} href={href} onClick={close} className="flex min-h-[48px] items-center rounded-xl px-2 text-[14px] text-ink transition-colors hover:bg-accent-wash hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">{label}</Link>
              ))}
            </nav>
            <div className="my-6 border-t border-line" />
            <SignOutButton />
          </motion.aside>
          </motion.div>}
        </AnimatePresence>
      </dialog>
    </>
  );
}
