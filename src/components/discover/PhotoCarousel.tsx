"use client";

import { useState } from "react";

export function PhotoCarousel({
  photos,
  alt,
}: {
  photos: string[];
  alt: string;
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
      />
      {photos.length > 1 && (
        <>
          <div className="absolute left-0 top-0 flex w-full gap-1 p-2">
            {photos.map((_, i) => (
              <div
                key={i}
                className={`h-[2px] flex-1 rounded-full transition-colors ${i === idx ? "bg-white" : "bg-white/35"}`}
              />
            ))}
          </div>
          <button
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-0 top-0 h-full w-[42%] cursor-pointer bg-transparent"
          />
          <button
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-0 top-0 h-full w-[42%] cursor-pointer bg-transparent"
          />
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
            {photos.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
