import { cn } from "@/lib/utils/cn";

export function Wordmark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-display font-normal tracking-[-0.04em] leading-none lowercase select-none",
        size === "sm" && "text-[22px]",
        size === "md" && "text-[26px]",
        size === "lg" && "text-[40px]",
        size === "hero" &&
          "text-[56px] sm:text-[84px] md:text-[96px] lg:text-[112px]",
        className,
      )}
    >
      us
    </span>
  );
}
