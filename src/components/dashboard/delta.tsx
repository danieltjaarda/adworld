import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { Delta } from "@/lib/analytics/metrics";
import { formatPercent } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

/**
 * Direction is interpreted, not assumed: a CPA going down is green, a CPA going up is
 * red, and the arrow always points the way the number actually moved.
 */
export function DeltaBadge({
  delta,
  className,
  showArrow = true,
}: {
  delta: Delta;
  className?: string;
  showArrow?: boolean;
}) {
  if (delta.percent === null) {
    return (
      <span className={cn("text-[12px] text-muted-foreground", className)}>
        No prior period
      </span>
    );
  }

  const rising = delta.percent > 0;
  const flat = Math.abs(delta.percent) < 0.0005;
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 text-[12px] font-medium",
        flat
          ? "text-muted-foreground"
          : delta.sentiment === "positive"
            ? "text-positive"
            : delta.sentiment === "negative"
              ? "text-negative"
              : "text-muted-foreground",
        className,
      )}
    >
      {showArrow ? <Icon className="size-3.5" aria-hidden /> : null}
      {formatPercent(Math.abs(delta.percent), { decimals: 1 })}
    </span>
  );
}
