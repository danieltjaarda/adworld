import { DeltaBadge } from "@/components/dashboard/delta";
import type { Delta } from "@/lib/analytics/metrics";
import { cn } from "@/lib/utils";

export type MetricCardProps = {
  label: string;
  value: string;
  delta?: Delta;
  hint?: string;
  emphasis?: boolean;
  className?: string;
};

/**
 * One metric, one card. Value first at a size you can read across a desk, the change
 * underneath, and nothing else competing for attention.
 */
export function MetricCard({ label, value, delta, hint, emphasis, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-card",
        emphasis && "ring-1 ring-primary/15",
        className,
      )}
    >
      <p className="text-[12px] font-medium leading-4 text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-2 font-semibold tracking-[-0.02em] text-foreground",
          emphasis ? "text-[26px] leading-8" : "text-[22px] leading-7",
        )}
      >
        {value}
      </p>
      <div className="mt-1.5 flex min-h-[18px] items-center gap-1.5">
        {delta ? <DeltaBadge delta={delta} /> : null}
        {hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

export function MetricGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6", className)}>
      {children}
    </div>
  );
}
