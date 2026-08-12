import { microsToUnits, roundTo, toNumber } from "@/lib/analytics/money";
import { safeDivide } from "@/lib/utils";

/**
 * The single definition of every derived metric in the product. Dashboards, reports,
 * the rule engine and the AI tools all read from here, so a number shown in the UI is
 * always the same number the AI reasoned about.
 */

/** Raw, additive counters exactly as Google reports them. */
export type RawMetrics = {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
  allConversions?: number;
  allConversionValueMicros?: number;
  searchImpressionShare?: number | null;
  searchBudgetLostImprShare?: number | null;
  searchRankLostImprShare?: number | null;
};

/** Raw counters in currency units plus every derived rate. */
export type DerivedMetrics = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  conversionRate: number | null;
  roas: number | null;
  aov: number | null;
  valuePerClick: number | null;
  searchImpressionShare: number | null;
  searchBudgetLostImprShare: number | null;
  searchRankLostImprShare: number | null;
};

export type ProfitConfig = {
  /** Share of revenue left after cost of goods, 0–100. */
  grossMarginPct?: number | null;
  /** Flat cost booked per conversion (picking, shipping, payment fees, ...). */
  fixedCostPerOrder?: number | null;
  /** Used when conversions carry no monetary value (lead generation). */
  leadValue?: number | null;
};

export type ProfitMetrics = {
  revenue: number;
  grossProfit: number;
  adSpend: number;
  otherCosts: number;
  netProfit: number;
  profitPerConversion: number | null;
  profitMargin: number | null;
  /** Profit on ad spend: net profit divided by ad spend. */
  poas: number | null;
  /** True when revenue was inferred from a configured lead value. */
  usesLeadValue: boolean;
};

export const EMPTY_RAW: RawMetrics = {
  impressions: 0,
  clicks: 0,
  costMicros: 0,
  conversions: 0,
  conversionValueMicros: 0,
  allConversions: 0,
  allConversionValueMicros: 0,
};

type MetricRow = {
  impressions: bigint | number;
  clicks: bigint | number;
  costMicros: bigint | number;
  conversions: number;
  conversionValueMicros: bigint | number;
  allConversions?: number;
  allConversionValueMicros?: bigint | number;
  searchImpressionShare?: unknown;
  searchBudgetLostImprShare?: unknown;
  searchRankLostImprShare?: unknown;
};

export function rawFromRow(row: MetricRow): RawMetrics {
  return {
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    costMicros: toNumber(row.costMicros),
    conversions: row.conversions ?? 0,
    conversionValueMicros: toNumber(row.conversionValueMicros),
    allConversions: row.allConversions ?? 0,
    allConversionValueMicros: toNumber(row.allConversionValueMicros ?? 0),
  };
}

export function addRaw(a: RawMetrics, b: RawMetrics): RawMetrics {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    costMicros: a.costMicros + b.costMicros,
    conversions: a.conversions + b.conversions,
    conversionValueMicros: a.conversionValueMicros + b.conversionValueMicros,
    allConversions: (a.allConversions ?? 0) + (b.allConversions ?? 0),
    allConversionValueMicros:
      (a.allConversionValueMicros ?? 0) + (b.allConversionValueMicros ?? 0),
  };
}

export function sumRaw(rows: readonly RawMetrics[]): RawMetrics {
  return rows.reduce(addRaw, { ...EMPTY_RAW });
}

/**
 * Impression share is a weighted average, not a sum: weight each day by impressions.
 * Passing the un-weighted mean here is the classic way to get a wrong number.
 */
export function weightedImpressionShare(
  rows: readonly { impressions: number; share: number | null }[],
): number | null {
  let weight = 0;
  let total = 0;
  for (const row of rows) {
    if (row.share === null || !Number.isFinite(row.share)) continue;
    weight += row.impressions;
    total += row.share * row.impressions;
  }
  return weight > 0 ? total / weight : null;
}

export function derive(raw: RawMetrics): DerivedMetrics {
  const cost = microsToUnits(raw.costMicros);
  const conversionValue = microsToUnits(raw.conversionValueMicros);

  return {
    impressions: raw.impressions,
    clicks: raw.clicks,
    cost: roundTo(cost, 2),
    conversions: roundTo(raw.conversions, 2),
    conversionValue: roundTo(conversionValue, 2),
    ctr: safeDivide(raw.clicks, raw.impressions),
    cpc: safeDivide(cost, raw.clicks),
    cpm: safeDivide(cost * 1000, raw.impressions),
    cpa: safeDivide(cost, raw.conversions),
    conversionRate: safeDivide(raw.conversions, raw.clicks),
    roas: safeDivide(conversionValue, cost),
    aov: safeDivide(conversionValue, raw.conversions),
    valuePerClick: safeDivide(conversionValue, raw.clicks),
    searchImpressionShare: raw.searchImpressionShare ?? null,
    searchBudgetLostImprShare: raw.searchBudgetLostImprShare ?? null,
    searchRankLostImprShare: raw.searchRankLostImprShare ?? null,
  };
}

export function computeProfit(metrics: DerivedMetrics, config: ProfitConfig): ProfitMetrics {
  const usesLeadValue = metrics.conversionValue <= 0 && Boolean(config.leadValue);
  const revenue = usesLeadValue
    ? metrics.conversions * (config.leadValue ?? 0)
    : metrics.conversionValue;

  const marginPct = config.grossMarginPct ?? 100;
  const grossProfit = revenue * (marginPct / 100);
  const otherCosts = (config.fixedCostPerOrder ?? 0) * metrics.conversions;
  const netProfit = grossProfit - metrics.cost - otherCosts;

  return {
    revenue: roundTo(revenue, 2),
    grossProfit: roundTo(grossProfit, 2),
    adSpend: metrics.cost,
    otherCosts: roundTo(otherCosts, 2),
    netProfit: roundTo(netProfit, 2),
    profitPerConversion: safeDivide(netProfit, metrics.conversions),
    profitMargin: safeDivide(netProfit, revenue),
    poas: safeDivide(netProfit, metrics.cost),
    usesLeadValue,
  };
}

export type MetricKey =
  | "cost"
  | "conversions"
  | "conversionValue"
  | "roas"
  | "cpa"
  | "clicks"
  | "impressions"
  | "ctr"
  | "cpc"
  | "conversionRate"
  | "profit";

export type MetricDirection = "higher-is-better" | "lower-is-better" | "neutral";

export const METRIC_DIRECTION: Record<MetricKey, MetricDirection> = {
  cost: "neutral",
  conversions: "higher-is-better",
  conversionValue: "higher-is-better",
  roas: "higher-is-better",
  cpa: "lower-is-better",
  clicks: "neutral",
  impressions: "neutral",
  ctr: "higher-is-better",
  cpc: "lower-is-better",
  conversionRate: "higher-is-better",
  profit: "higher-is-better",
};

export type MetricFormat = "currency" | "number" | "percent" | "ratio" | "decimal";

export const METRIC_FORMAT: Record<MetricKey, MetricFormat> = {
  cost: "currency",
  conversions: "decimal",
  conversionValue: "currency",
  roas: "ratio",
  cpa: "currency",
  clicks: "number",
  impressions: "number",
  ctr: "percent",
  cpc: "currency",
  conversionRate: "percent",
  profit: "currency",
};

export const METRIC_LABEL: Record<MetricKey, string> = {
  cost: "Spend",
  conversions: "Conversions",
  conversionValue: "Revenue",
  roas: "ROAS",
  cpa: "CPA",
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "CTR",
  cpc: "CPC",
  conversionRate: "Conv. rate",
  profit: "Profit",
};

export type Delta = {
  current: number | null;
  previous: number | null;
  absolute: number | null;
  percent: number | null;
  /** Interpreted against the metric's direction, not the raw sign. */
  sentiment: "positive" | "negative" | "neutral";
};

export function computeDelta(
  current: number | null,
  previous: number | null,
  direction: MetricDirection,
): Delta {
  if (current === null || previous === null) {
    return { current, previous, absolute: null, percent: null, sentiment: "neutral" };
  }

  const absolute = current - previous;
  const percent = previous === 0 ? null : absolute / Math.abs(previous);

  let sentiment: Delta["sentiment"] = "neutral";
  if (direction !== "neutral" && absolute !== 0) {
    const improved = direction === "higher-is-better" ? absolute > 0 : absolute < 0;
    sentiment = improved ? "positive" : "negative";
  }

  return { current, previous, absolute, percent, sentiment };
}

/**
 * Percentage change expressed as whole percent (-63 means "down 63%"). Returns null
 * when there is no baseline to compare against, which callers must treat as "unknown"
 * rather than "no change".
 */
export function safePercentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function pickMetric(
  metrics: DerivedMetrics,
  profit: ProfitMetrics | null,
  key: MetricKey,
): number | null {
  switch (key) {
    case "profit":
      return profit ? profit.netProfit : null;
    case "conversionValue":
      return metrics.conversionValue;
    default:
      return metrics[key];
  }
}

/**
 * Sample-size guard shared by every optimizer. Acting on 2 clicks is the fastest way
 * to destroy an account, so decisions are blocked until the data supports them.
 */
export type DataSufficiency = {
  sufficient: boolean;
  reasons: string[];
  /** 0–1 score used to scale confidence, not to bypass the hard gate. */
  strength: number;
};

export function assessDataSufficiency(
  raw: RawMetrics,
  thresholds: { minClicks: number; minImpressions: number; minSpend: number },
): DataSufficiency {
  const cost = microsToUnits(raw.costMicros);
  const reasons: string[] = [];

  if (raw.clicks < thresholds.minClicks) {
    reasons.push(`only ${raw.clicks} clicks (needs ${thresholds.minClicks})`);
  }
  if (raw.impressions < thresholds.minImpressions) {
    reasons.push(`only ${raw.impressions} impressions (needs ${thresholds.minImpressions})`);
  }
  if (cost < thresholds.minSpend) {
    reasons.push(`only ${cost.toFixed(2)} spend (needs ${thresholds.minSpend})`);
  }

  const ratios = [
    thresholds.minClicks > 0 ? raw.clicks / thresholds.minClicks : 1,
    thresholds.minImpressions > 0 ? raw.impressions / thresholds.minImpressions : 1,
    thresholds.minSpend > 0 ? cost / thresholds.minSpend : 1,
  ];

  return {
    sufficient: reasons.length === 0,
    reasons,
    strength: Math.min(1, Math.max(...ratios.map((ratio) => Math.min(ratio, 2))) / 2),
  };
}
