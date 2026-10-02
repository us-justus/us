/**
 * /matches loading state — static and calm. No skeleton shimmer: the CSS
 * reduced-motion reset does not need to do any work here because nothing
 * animates.
 */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="loading your matches"
      className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14"
    >
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        matches
      </p>
      <h1 className="mt-3 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        it&apos;s a match.
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-ink-soft">loading your matches…</p>
    </div>
  );
}
