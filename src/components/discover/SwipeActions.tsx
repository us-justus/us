"use client";

export function SwipeActions({
  onPass,
  onLike,
  disabled,
  name,
}: {
  onPass: () => void;
  onLike: () => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        aria-label={name ? `Pass ${name}` : "Pass"}
        onClick={onPass}
        disabled={disabled}
        className="inline-flex h-[56px] w-[56px] items-center justify-center rounded-full border border-line bg-paper text-ink-soft shadow-sm transition hover:text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
      >
        <span aria-hidden className="text-[20px] leading-none">
          ×
        </span>
      </button>
      <button
        aria-label={name ? `Like ${name}` : "Like"}
        onClick={onLike}
        disabled={disabled}
        className="inline-flex h-[56px] w-[56px] items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
      >
        <span aria-hidden className="text-[18px] leading-none">
          ♡
        </span>
      </button>
    </div>
  );
}
