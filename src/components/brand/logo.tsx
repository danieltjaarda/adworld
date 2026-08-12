import { cn } from "@/lib/utils";

/**
 * Wordmark. The glyph is a rising bar chart cut into a rounded square — a product mark
 * rather than a generic sparkle, which is exactly what the category is drowning in.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-primary-foreground",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 20 20" fill="none" className="size-4">
        <path d="M4 13.5V16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M8.667 10V16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M13.333 6.5V16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="15.5" cy="4.5" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          AdLeverage
        </span>
      ) : null}
    </span>
  );
}
