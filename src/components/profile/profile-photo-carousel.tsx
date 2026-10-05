"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import type { OwnPhoto } from "@/lib/profile/queries";

export function ProfilePhotoCarousel({ photos, name }: { photos: OwnPhoto[]; name: string }) {
  const [active, setActive] = useState(0);
  const viewer = useRef<HTMLDialogElement>(null);
  const photoButton = useRef<HTMLButtonElement>(null);
  const touchStart = useRef(0);
  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStart.current = event.touches[0]?.clientX ?? 0;
  }
  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
    if (Math.abs(delta) > 40) setActive((index) => Math.max(0, Math.min(photos.length - 1, index + (delta < 0 ? 1 : -1))));
  }
  useEffect(() => {
    const dialog = viewer.current;
    if (!dialog) return;
    const restoreFocus = () => photoButton.current?.focus();
    dialog.addEventListener("close", restoreFocus);
    return () => dialog.removeEventListener("close", restoreFocus);
  }, []);

  const photo = photos[active];
  function openViewer() {
    viewer.current?.showModal();
  }
  function closeViewer() {
    viewer.current?.close();
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-[28px] border border-line bg-paper-2" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="aspect-[4/5] sm:aspect-[4/5]">
          <button ref={photoButton} type="button" onClick={openViewer} aria-label={`Enlarge ${name}'s photo`} className="block h-full w-full focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`${name} photo ${active + 1}`} className="h-full w-full object-cover object-[50%_32%]" decoding="async" loading="eager" fetchPriority="high" />
          </button>
        </div>
        {photos.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" disabled={active === 0} onClick={() => setActive((index) => index - 1)} className="absolute inset-y-0 left-0 w-1/3 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent" />
            <button type="button" aria-label="Next photo" disabled={active === photos.length - 1} onClick={() => setActive((index) => index + 1)} className="absolute inset-y-0 right-0 w-1/3 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent" />
            <div aria-label={`Photo ${active + 1} of ${photos.length}`} className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" role="group">
              {photos.map((item, index) => <span key={item.id} className={`h-1 w-5 rounded-full ${index === active ? "bg-paper" : "bg-paper/45"}`} />)}
            </div>
          </>
        )}
      </div>
      <dialog ref={viewer} aria-label={`${name}'s photo`} onClick={(event) => { if (event.target === viewer.current) closeViewer(); }} onCancel={(event) => { event.preventDefault(); closeViewer(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-ink/95 p-0 text-paper backdrop:bg-ink/80 open:flex open:items-center open:justify-center motion-reduce:transition-none">
        <div className="relative flex h-full w-full items-center justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          <button type="button" onClick={closeViewer} aria-label="Close photo" autoFocus className="absolute right-4 top-[calc(env(safe-area-inset-top)+0.5rem)] z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-paper/40 bg-ink/40 text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={`${name} photo ${active + 1}`} className="max-h-full max-w-full object-contain" decoding="async" />
          {photos.length > 1 && <p className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] text-[11px] tracking-[0.14em] text-paper/80">{active + 1} / {photos.length}</p>}
        </div>
      </dialog>
    </>
  );
}
