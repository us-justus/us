"use client";

import type { DiscoverProfile } from "@/lib/discover/types";
import { PhotoCarousel } from "./PhotoCarousel";

export function ProfileCard({ profile, priority = false }: { profile: DiscoverProfile; priority?: boolean }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-line bg-paper shadow-[0_16px_40px_rgba(23,22,20,0.08)]">
      <div className="relative flex-1 overflow-hidden bg-paper-2">
        <PhotoCarousel photos={profile.photos} alt={profile.nickname} priority={priority} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <h2 className="font-display text-[28px] leading-none tracking-[-0.03em] text-white">
            {profile.nickname}, {profile.age}
          </h2>
          <p className="mt-1 text-[13px] tracking-[0.04em] text-white/85">
            {profile.branch} · {profile.year} year
          </p>
          {profile.bio && (
            <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-white/85">{profile.bio}</p>
          )}
          {profile.interests.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.interests.slice(0, 5).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] tracking-wide text-white"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
