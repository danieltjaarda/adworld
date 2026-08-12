"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatCompactDate,
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatRatio,
} from "@/lib/analytics/format";
import type { MetricKey } from "@/lib/analytics/metrics";
import { cn } from "@/lib/utils";

export type ChartPoint = {
  date: string;
  cost: number;
  conversions: number;
  conversionValue: number;
  roas: number | null;
  cpa: number | null;
  profit: number;
};

type Option = { key: MetricKey; label: string };

const OPTIONS: Option[] = [
  { key: "cost", label: "Spend" },
  { key: "conversionValue", label: "Revenue" },
  { key: "conversions", label: "Conversions" },
  { key: "roas", label: "ROAS" },
  { key: "cpa", label: "CPA" },
  { key: "profit", label: "Profit" },
];

/**
 * One chart, one metric at a time. Overlaying six series on two axes looks impressive
 * in a screenshot and is unreadable in daily use.
 */
export function PerformanceChart({
  data,
  currency,
  defaultMetric = "cost",
  showProfit = true,
}: {
  data: ChartPoint[];
  currency: string;
  defaultMetric?: MetricKey;
  showProfit?: boolean;
}) {
  const [metric, setMetric] = useState<MetricKey>(defaultMetric);

  const options = showProfit ? OPTIONS : OPTIONS.filter((option) => option.key !== "profit");

  const series = useMemo(
    () =>
      data.map((point) => ({
        date: point.date,
        value: valueFor(point, metric),
      })),
    [data, metric],
  );

  const hasValues = series.some((point) => point.value !== null && point.value !== 0);

  return (
    <div>
      <div className="flex flex-wrap gap-1 px-5 pt-4">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setMetric(option.key)}
            className={cn(
              "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
              metric === option.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="h-[268px] w-full px-1 pb-2 pt-4">
        {hasValues ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />

              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => formatCompactDate(value)}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                tickFormatter={(value: number) => axisLabel(value, metric, currency)}
                tickLine={false}
                axisLine={false}
                width={58}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />

              <Tooltip
                cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const value = payload[0]?.value as number | null;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-overlay">
                      <p className="text-[11px] text-muted-foreground">
                        {formatCompactDate(String(label))}
                      </p>
                      <p className="tabular mt-0.5 text-[13px] font-semibold">
                        {formatValue(value, metric, currency)}
                      </p>
                    </div>
                  );
                }}
              />

              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#metricFill)"
                connectNulls
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            No {OPTIONS.find((option) => option.key === metric)?.label.toLowerCase()} recorded in
            this period.
          </div>
        )}
      </div>
    </div>
  );
}

function valueFor(point: ChartPoint, metric: MetricKey): number | null {
  switch (metric) {
    case "cost":
      return point.cost;
    case "conversionValue":
      return point.conversionValue;
    case "conversions":
      return point.conversions;
    case "roas":
      return point.roas;
    case "cpa":
      return point.cpa;
    case "profit":
      return point.profit;
    default:
      return null;
  }
}

function axisLabel(value: number, metric: MetricKey, currency: string): string {
  if (metric === "roas") return `${value.toFixed(1)}x`;
  if (metric === "conversions") return formatNumber(value);
  return formatCurrency(value, currency, { compact: true, decimals: 0 });
}

function formatValue(value: number | null, metric: MetricKey, currency: string): string {
  if (value === null) return "—";
  if (metric === "roas") return formatRatio(value);
  if (metric === "conversions") return formatDecimal(value, 1);
  return formatCurrency(value, currency, { decimals: 2 });
}
