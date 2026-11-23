"use client";

export default function InsideError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-10 sm:px-8 sm:py-14">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-faint">Inside unavailable</p>
      <h1 className="mt-3 font-display text-[30px] leading-none tracking-[-0.03em]">Something went wrong.</h1>
      <p className="mt-4 text-sm text-ink-soft">Refresh and try again. Your session was not changed.</p>
      <button type="button" onClick={reset} className="mt-6 min-h-11 w-fit rounded-full bg-ink px-5 text-sm text-paper hover:bg-black">
        Try again
      </button>
    </main>
  );
}
