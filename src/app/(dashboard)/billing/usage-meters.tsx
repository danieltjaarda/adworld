import { formatNumber } from "@/lib/analytics/format";
import type { UsageSnapshot } from "@/lib/billing/limits";
import { cn } from "@/lib/utils";

/**
 * Usage against plan limits. Bars only appear where there is a limit — an unlimited
 * counter is a number, not a progress bar at 0%.
 */
export function UsageMeters({ usage }: { usage: UsageSnapshot }) {
  const meters = [
    { label: "Google Ads accounts", ...usage.accounts },
    { label: "Team members", ...usage.members },
    { label: "AI changes applied", ...usage.aiActions },
    { label: "AI messages", ...usage.chatMessages },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {meters.map((meter) => {
        const ratio = meter.limit ? Math.min(1, meter.used / meter.limit) : 0;
        const nearLimit = meter.limit !== null && ratio >= 0.8;

        return (
          <div key={meter.label}>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[13px] text-muted-foreground">{meter.label}</dt>
              <dd className="tabular text-[13px] font-medium">
                {formatNumber(meter.used)}
                <span className="text-muted-foreground">
                  {meter.limit === null ? " of unlimited" : ` of ${formatNumber(meter.limit)}`}
                </span>
              </dd>
            </div>

            {meter.limit !== null ? (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width]",
                    ratio >= 1 ? "bg-negative" : nearLimit ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(ratio * 100, meter.used > 0 ? 4 : 0)}%` }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
