"use client";

import { useState } from "react";

export function PhotoCarousel({
  photos,
  alt,
  priority = false,
}: {
  photos: string[];
  alt: string;
  /**
   * True for the top stacked cards. The visible photo loads eagerly with high
   * fetch priority and async decoding; all other photos lazy-load so far
   * cards never compete with the current card for bandwidth/decode time.
   */
  priority?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  if (!photos.length) return null;

  function go(dir: number) {
    setIdx((v) => Math.max(0, Math.min(photos.length - 1, v + dir)));
  }

  return (
    <div className="absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[idx]}
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
        decoding="async"
        loading={priority && idx === 0 ? "eager" : "lazy"}
        fetchPriority={priority && idx === 0 ? "high" : "auto"}
      />
      {photos.length > 1 && (
        <>
          <div className="absolute left-0 top-0 flex w-full gap-1 p-2">
            {photos.map((_, i) => (
              <div
                key={i}
                className={`h-[2px] flex-1 rounded-full transition-colors ${i === idx ? "bg-paper" : "bg-paper/35"}`}
              />
            ))}
          </div>
          <button
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-0 top-0 h-full w-[42%] cursor-pointer bg-transparent focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-0 top-0 h-full w-[42%] cursor-pointer bg-transparent focus-visible:outline-2 focus-visible:outline-accent"
          />
        </>
      )}
    </div>
  );
}
