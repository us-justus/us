"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import type { DiscoverProfile } from "@/lib/discover/types";
import {
  CARD_STACK_OFFSET,
  CARD_STACK_SCALE,
  EXIT_DISTANCE,
  MAX_ROTATION,
  SPRING_CONFIG,
  SWIPE_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
} from "@/lib/discover/constants";
import { ProfileCard } from "./ProfileCard";
import { SwipeActions } from "./SwipeActions";
import { MatchOverlay } from "./MatchOverlay";
import { swipeAction } from "@/lib/discover/actions";

function DraggableCard({
  profile,
  onSwipe,
}: {
  profile: DiscoverProfile;
  onSwipe: (dir: "like" | "pass") => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, (v) => Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, v * 0.06)));
  const likeOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const passOpacity = useTransform(x, [0, -SWIPE_THRESHOLD], [0, 1]);

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const ox = info.offset.x;
    const vx = info.velocity.x;
    const dismiss = Math.abs(ox) > SWIPE_THRESHOLD || Math.abs(vx) > SWIPE_VELOCITY_THRESHOLD;
    if (!dismiss) {
      animate(x, 0, SPRING_CONFIG);
      return;
    }
    const dir = ox > 0 || vx > 0 ? "like" : "pass";
    const exit = dir === "like" ? EXIT_DISTANCE : -EXIT_DISTANCE;
    animate(x, exit, { type: "spring", stiffness: 380, damping: 32 }).then(() => onSwipe(dir as "like" | "pass"));
  }

  return (
    <motion.div
      drag="x"
      dragElastic={0.18}
      dragMomentum={false}
      dragConstraints={{ left: 0, right: 0 }}
      style={{ x, rotate, touchAction: "pan-y" }}
      onDragEnd={handleDragEnd}
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
    >
      <ProfileCard profile={profile} />
      <motion.div style={{ opacity: likeOpacity }} className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/90 border border-white/40 px-3 py-1.5 text-[11px] font-medium tracking-[0.14em] uppercase text-ink">
        like
      </motion.div>
      <motion.div style={{ opacity: passOpacity }} className="pointer-events-none absolute right-4 top-4 rounded-full bg-ink/90 border border-white/20 px-3 py-1.5 text-[11px] font-medium tracking-[0.14em] uppercase text-white">
        pass
      </motion.div>
    </motion.div>
  );
}

export function DiscoverDeck({ initialProfiles }: { initialProfiles: DiscoverProfile[] }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [matched, setMatched] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitX = useMotionValue(0);
  const pendingRef = useRef(false);

  const persistAndAdvance = useCallback(
    (dir: "like" | "pass", userId: string) => {
      swipeAction(userId, dir)
        .then((r) => {
          if (r.matched) setMatched(true);
        })
        .catch(() => {});
    },
    [],
  );

  const handleDragSwipe = useCallback(
    (dir: "like" | "pass") => {
      if (!profiles.length) return;
      const current = profiles[0];
      persistAndAdvance(dir, current.userId);
      setTimeout(() => setProfiles((p) => p.slice(1)), 180);
    },
    [profiles, persistAndAdvance],
  );

  const handleButtonSwipe = useCallback(
    (dir: "like" | "pass") => {
      if (pendingRef.current || isExiting || !profiles.length) return;
      pendingRef.current = true;
      setIsExiting(true);
      const current = profiles[0];
      persistAndAdvance(dir, current.userId);
      const exit = dir === "like" ? EXIT_DISTANCE : -EXIT_DISTANCE;
      animate(exitX, exit, { type: "spring", stiffness: 380, damping: 32 }).then(() => {
        setProfiles((p) => p.slice(1));
        setIsExiting(false);
        exitX.set(0);
        pendingRef.current = false;
      });
    },
    [profiles, isExiting, persistAndAdvance, exitX],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isExiting || pendingRef.current) return;
      if (e.key === "ArrowRight") handleButtonSwipe("like");
      if (e.key === "ArrowLeft") handleButtonSwipe("pass");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExiting, handleButtonSwipe]);

  const top = profiles[0];
  const next = profiles[1];
  const third = profiles[2];

  if (!top) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="font-display text-[28px] tracking-[-0.03em] text-ink">that&apos;s everyone for now.</p>
        <p className="mt-2 text-[14px] text-ink-soft">check back later.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="flex w-full max-w-[380px] flex-1 flex-col px-4 pb-6 pt-4 sm:pt-6">
        <div className="relative flex-1 min-h-[480px] sm:min-h-[520px]">
          {third && (
            <div
              className="absolute inset-0 rounded-[28px]"
              style={{ transform: `scale(${CARD_STACK_SCALE - 0.02}) translateY(${CARD_STACK_OFFSET * 2}px)` }}
            >
              <ProfileCard profile={third} />
            </div>
          )}
          {next && (
            <motion.div
              className="absolute inset-0"
              animate={{ scale: isExiting ? 1 : CARD_STACK_SCALE, y: isExiting ? 0 : CARD_STACK_OFFSET }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            >
              <ProfileCard profile={next} />
            </motion.div>
          )}
          {isExiting ? (
            <motion.div className="absolute inset-0" style={{ x: exitX }}>
              <ProfileCard profile={top} />
            </motion.div>
          ) : (
            <DraggableCard key={top.userId} profile={top} onSwipe={handleDragSwipe} />
          )}
        </div>
        <div className="mt-6 flex justify-center">
          <SwipeActions onPass={() => handleButtonSwipe("pass")} onLike={() => handleButtonSwipe("like")} name={top.nickname} disabled={isExiting} />
        </div>
      </div>
      {matched && <MatchOverlay onKeepDiscovering={() => setMatched(false)} />}
    </div>
  );
}
