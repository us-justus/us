import { cn } from "@/lib/utils/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "subtle";
};

export function Button({
  variant = "primary",
  className,
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 text-[13px] tracking-[0.14em] uppercase font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" &&
          "bg-ink text-paper hover:bg-black focus-visible:bg-black px-8 py-[15px] rounded-full",
        variant === "ghost" &&
          "text-ink-soft hover:text-accent-deep hover:bg-accent-wash px-4 py-2 rounded-full",
        variant === "subtle" &&
          "border border-line bg-paper hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep text-ink px-6 py-3 rounded-full",
        className,
      )}
      {...props}
    />
  );
}
