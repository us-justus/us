"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        chat
      </p>
      <h1 className="mt-3 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        something went quiet.
      </h1>
      <div role="alert" className="mt-8 rounded-2xl border border-accent-soft bg-accent-wash px-5 py-6 text-center">
        <p className="text-[14px] leading-6 text-accent-deep">
          couldn&apos;t open this conversation. please try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-paper px-6 py-3 text-[13px] tracking-[0.14em] uppercase font-medium text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          try again
        </button>
      </div>
    </div>
  );
}
