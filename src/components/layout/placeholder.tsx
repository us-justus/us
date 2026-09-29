import Link from "next/link";

export function Placeholder({
  title,
  caption,
  note,
}: {
  title: string;
  caption: string;
  note: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[11px] tracking-[0.2em] uppercase text-ink-faint">
        {caption}
      </p>
      <h1 className="mt-3 font-display text-[32px] sm:text-[40px] tracking-[-0.03em] leading-none">
        {title}
      </h1>
      <p className="mt-4 max-w-[32ch] text-[14px] leading-6 text-ink-soft">
        {note}
      </p>
      <div className="mt-8 h-px w-12 bg-line-strong" />
      <p className="mt-8 text-[11px] tracking-[0.14em] uppercase text-ink-faint">
        coming soon — stay close
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-full text-[13px] tracking-[0.08em] lowercase text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        back to us
      </Link>
    </div>
  );
}
