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
        "inline-flex items-center justify-center gap-2 text-[13px] tracking-[0.14em] uppercase font-medium transition-colors focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" &&
          "bg-ink text-paper hover:bg-black px-8 py-[15px] rounded-full",
        variant === "ghost" &&
          "text-ink-soft hover:text-ink px-4 py-2",
        variant === "subtle" &&
          "border border-line bg-paper hover:bg-paper-2 text-ink px-6 py-3 rounded-full",
        className,
      )}
      {...props}
    />
  );
}
