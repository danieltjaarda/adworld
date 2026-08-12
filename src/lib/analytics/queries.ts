import "server-only";

import type { DateRange } from "@/lib/analytics/date-range";
import { previousRange, rangeToDates, toDateKey } from "@/lib/analytics/date-range";
import {
  computeDelta,
  computeProfit,
  derive,
  METRIC_DIRECTION,
  type DerivedMetrics,
  type MetricKey,
  type ProfitConfig,
  type ProfitMetrics,
  type RawMetrics,
} from "@/lib/analytics/metrics";
import { decimalToNumber, toNumber } from "@/lib/analytics/money";
import { prisma } from "@/lib/db/prisma";

/**
 * Every number the product displays or feeds to the AI comes from one of these
 * queries. They all take `organizationId` explicitly — tenant scoping is a parameter,
 * not an assumption.
 */

export type Scope = {
  organizationId: string;
  accountId: string;
};

type SumRow = {
  _sum: {
    impressions: bigint | null;
    clicks: bigint | null;
    costMicros: bigint | null;
    conversions: number | null;
    conversionValueMicros: bigint | null;
    allConversions?: number | null;
    allConversionValueMicros?: bigint | null;
  };
};

function rawFromSum(row: SumRow | null | undefined): RawMetrics {
  return {
    impressions: toNumber(row?._sum.impressions ?? 0),
    clicks: toNumber(row?._sum.clicks ?? 0),
    costMicros: toNumber(row?._sum.costMicros ?? 0),
    conversions: row?._sum.conversions ?? 0,
    conversionValueMicros: toNumber(row?._sum.conversionValueMicros ?? 0),
    allConversions: row?._sum.allConversions ?? 0,
    allConversionValueMicros: toNumber(row?._sum.allConversionValueMicros ?? 0),
  };
}

const METRIC_SUM = {
  impressions: true,
  clicks: true,
  costMicros: true,
  conversions: true,
  conversionValueMicros: true,
  allConversions: true,
  allConversionValueMicros: true,
} as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AccountSettings = {
  mode: "SUGGESTIONS" | "APPROVAL" | "AUTOMATIC";
  targetRoas: number | null;
  targetCpa: number | null;
  maxDailyBudget: number | null;
  minProfitPerConversion: number | null;
  grossMarginPct: number | null;
  cogsPct: number | null;
  leadValue: number | null;
  customerValue: number | null;
  fixedCostPerOrder: number | null;
  maxDailyBudgetIncreasePct: number;
  maxDailyBudgetDecreasePct: number;
  maxBidChangePct: number;
  maxActionsPerRun: number;
  minClicksForDecision: number;
  minImpressionsForDecision: number;
  minSpendForDecision: number;
  minConversionsForScaling: number;
  lookbackDays: number;
  minConfidence: number;
  autoNegativeKeywords: boolean;
  autoAddKeywords: boolean;
  autoBidChanges: boolean;
  autoBudgetChanges: boolean;
  autoPauseKeywords: boolean;
  autoPauseAds: boolean;
  notifyOnRecommendation: boolean;
  notifyOnAnomaly: boolean;
  notifyOnAutoAction: boolean;
  weeklyReportEmail: boolean;
};

export const DEFAULT_SETTINGS: AccountSettings = {
  mode: "SUGGESTIONS",
  targetRoas: null,
  targetCpa: null,
  maxDailyBudget: null,
  minProfitPerConversion: null,
  grossMarginPct: null,
  cogsPct: null,
  leadValue: null,
  customerValue: null,
  fixedCostPerOrder: null,
  maxDailyBudgetIncreasePct: 20,
  maxDailyBudgetDecreasePct: 20,
  maxBidChangePct: 25,
  maxActionsPerRun: 25,
  minClicksForDecision: 30,
  minImpressionsForDecision: 500,
  minSpendForDecision: 50,
  minConversionsForScaling: 3,
  lookbackDays: 30,
  minConfidence: 0.7,
  autoNegativeKeywords: false,
  autoAddKeywords: false,
  autoBidChanges: false,
  autoBudgetChanges: false,
  autoPauseKeywords: false,
  autoPauseAds: false,
  notifyOnRecommendation: true,
  notifyOnAnomaly: true,
  notifyOnAutoAction: true,
  weeklyReportEmail: true,
};

export async function getAccountSettings(scope: Scope): Promise<AccountSettings> {
  const row = await prisma.optimizationSettings.findFirst({
    where: { accountId: scope.accountId, account: { organizationId: scope.organizationId } },
  });

  if (!row) return { ...DEFAULT_SETTINGS };

  return {
    mode: row.mode,
    targetRoas: decimalToNumber(row.targetRoas),
    targetCpa: decimalToNumber(row.targetCpa),
    maxDailyBudget: decimalToNumber(row.maxDailyBudget),
    minProfitPerConversion: decimalToNumber(row.minProfitPerConversion),
    grossMarginPct: decimalToNumber(row.grossMarginPct),
    cogsPct: decimalToNumber(row.cogsPct),
    leadValue: decimalToNumber(row.leadValue),
    customerValue: decimalToNumber(row.customerValue),
    fixedCostPerOrder: decimalToNumber(row.fixedCostPerOrder),
    maxDailyBudgetIncreasePct: decimalToNumber(row.maxDailyBudgetIncreasePct) ?? 20,
    maxDailyBudgetDecreasePct: decimalToNumber(row.maxDailyBudgetDecreasePct) ?? 20,
    maxBidChangePct: decimalToNumber(row.maxBidChangePct) ?? 25,
    maxActionsPerRun: row.maxActionsPerRun,
    minClicksForDecision: row.minClicksForDecision,
    minImpressionsForDecision: row.minImpressionsForDecision,
    minSpendForDecision: decimalToNumber(row.minSpendForDecision) ?? 50,
    minConversionsForScaling: decimalToNumber(row.minConversionsForScaling) ?? 3,
    lookbackDays: row.lookbackDays,
    minConfidence: decimalToNumber(row.minConfidence) ?? 0.7,
    autoNegativeKeywords: row.autoNegativeKeywords,
    autoAddKeywords: row.autoAddKeywords,
    autoBidChanges: row.autoBidChanges,
    autoBudgetChanges: row.autoBudgetChanges,
    autoPauseKeywords: row.autoPauseKeywords,
    autoPauseAds: row.autoPauseAds,
    notifyOnRecommendation: row.notifyOnRecommendation,
    notifyOnAnomaly: row.notifyOnAnomaly,
    notifyOnAutoAction: row.notifyOnAutoAction,
    weeklyReportEmail: row.weeklyReportEmail,
  };
}

export function profitConfigFrom(settings: AccountSettings): ProfitConfig {
  return {
    grossMarginPct: settings.grossMarginPct,
    fixedCostPerOrder: settings.fixedCostPerOrder,
    leadValue: settings.leadValue,
  };
}

// ---------------------------------------------------------------------------
// Totals & comparisons
// ---------------------------------------------------------------------------

export async function getTotals(
  scope: Scope,
  range: { start: string; end: string },
  level: "ACCOUNT" | "CAMPAIGN" = "ACCOUNT",
): Promise<RawMetrics> {
  const aggregate = await prisma.dailyMetric.aggregate({
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      level,
      date: rangeToDates(range),
    },
    _sum: METRIC_SUM,
  });

  return rawFromSum(aggregate);
}

export type PeriodComparison = {
  range: { start: string; end: string };
  comparison: { start: string; end: string };
  current: DerivedMetrics;
  previous: DerivedMetrics;
  currentProfit: ProfitMetrics;
  previousProfit: ProfitMetrics;
  deltas: Record<MetricKey, ReturnType<typeof computeDelta>>;
};

export async function getPeriodComparison(
  scope: Scope,
  range: DateRange | { start: string; end: string },
  profitConfig: ProfitConfig,
): Promise<PeriodComparison> {
  const comparison = previousRange(range);

  const [currentRaw, previousRaw] = await Promise.all([
    getTotals(scope, range),
    getTotals(scope, comparison),
  ]);

  const current = derive(currentRaw);
  const previous = derive(previousRaw);
  const currentProfit = computeProfit(current, profitConfig);
  const previousProfit = computeProfit(previous, profitConfig);

  const keys: MetricKey[] = [
    "cost",
    "conversions",
    "conversionValue",
    "roas",
    "cpa",
    "clicks",
    "impressions",
    "ctr",
    "cpc",
    "conversionRate",
    "profit",
  ];

  const deltas = {} as PeriodComparison["deltas"];
  for (const key of keys) {
    const currentValue = key === "profit" ? currentProfit.netProfit : current[key];
    const previousValue = key === "profit" ? previousProfit.netProfit : previous[key];
    deltas[key] = computeDelta(currentValue, previousValue, METRIC_DIRECTION[key]);
  }

  return {
    range: { start: range.start, end: range.end },
    comparison,
    current,
    previous,
    currentProfit,
    previousProfit,
    deltas,
  };
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

export type TimeSeriesPoint = {
  date: string;
  cost: number;
  conversions: number;
  conversionValue: number;
  clicks: number;
  impressions: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpc: number | null;
  conversionRate: number | null;
  profit: number;
};

export async function getTimeSeries(
  scope: Scope,
  range: { start: string; end: string },
  profitConfig: ProfitConfig,
): Promise<TimeSeriesPoint[]> {
  const rows = await prisma.dailyMetric.groupBy({
    by: ["date"],
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      level: "ACCOUNT",
      date: rangeToDates(range),
    },
    _sum: METRIC_SUM,
    orderBy: { date: "asc" },
  });

  return rows.map((row) => {
    const metrics = derive(rawFromSum(row));
    const profit = computeProfit(metrics, profitConfig);
    return {
      date: toDateKey(row.date),
      cost: metrics.cost,
      conversions: metrics.conversions,
      conversionValue: metrics.conversionValue,
      clicks: metrics.clicks,
      impressions: metrics.impressions,
      roas: metrics.roas,
      cpa: metrics.cpa,
      ctr: metrics.ctr,
      cpc: metrics.cpc,
      conversionRate: metrics.conversionRate,
      profit: profit.netProfit,
    };
  });
}

// ---------------------------------------------------------------------------
// Entity performance
// ---------------------------------------------------------------------------

export type EntityPerformance<TExtra = Record<string, never>> = {
  id: string;
  externalId: string;
  name: string;
  status: string;
  metrics: DerivedMetrics;
  profit: ProfitMetrics;
} & TExtra;

export type CampaignPerformance = EntityPerformance<{
  campaignId: string;
  budget: number;
  budgetId: string | null;
  biddingStrategy: string | null;
  advertisingChannel: string;
  targetRoas: number | null;
  impressionShare: number | null;
  budgetLostImpressionShare: number | null;
  rankLostImpressionShare: number | null;
  isBudgetLimited: boolean;
  averageDailySpend: number;
}>;

export async function getCampaignPerformance(
  scope: Scope,
  range: { start: string; end: string },
  profitConfig: ProfitConfig,
  options: { includeRemoved?: boolean } = {},
): Promise<CampaignPerformance[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      ...(options.includeRemoved ? {} : { status: { not: "REMOVED" } }),
    },
    select: {
      id: true,
      campaignId: true,
      name: true,
      status: true,
      budgetId: true,
      budgetAmountMicros: true,
      biddingStrategyType: true,
      advertisingChannel: true,
      targetRoas: true,
    },
  });

  if (campaigns.length === 0) return [];

  const [sums, shares] = await Promise.all([
    prisma.dailyMetric.groupBy({
      by: ["campaignRowId"],
      where: {
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        level: "CAMPAIGN",
        date: rangeToDates(range),
        campaignRowId: { in: campaigns.map((campaign) => campaign.id) },
      },
      _sum: METRIC_SUM,
    }),
    prisma.dailyMetric.groupBy({
      by: ["campaignRowId"],
      where: {
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        level: "CAMPAIGN",
        date: rangeToDates(range),
        campaignRowId: { in: campaigns.map((campaign) => campaign.id) },
      },
      _avg: {
        searchImpressionShare: true,
        searchBudgetLostImprShare: true,
        searchRankLostImprShare: true,
      },
      _count: { _all: true },
    }),
  ]);

  const sumByCampaign = new Map(sums.map((row) => [row.campaignRowId, row]));
  const shareByCampaign = new Map(shares.map((row) => [row.campaignRowId, row]));

  return campaigns
    .map((campaign) => {
      const metrics = derive(rawFromSum(sumByCampaign.get(campaign.id)));
      const share = shareByCampaign.get(campaign.id);
      const days = share?._count._all ?? 0;
      const budgetLost = decimalToNumber(share?._avg.searchBudgetLostImprShare);
      const budget = toNumber(campaign.budgetAmountMicros) / 1_000_000;
      const averageDailySpend = days > 0 ? metrics.cost / days : 0;

      return {
        id: campaign.id,
        externalId: campaign.campaignId,
        campaignId: campaign.campaignId,
        name: campaign.name,
        status: campaign.status,
        budget,
        budgetId: campaign.budgetId,
        biddingStrategy: campaign.biddingStrategyType,
        advertisingChannel: campaign.advertisingChannel,
        targetRoas: decimalToNumber(campaign.targetRoas),
        metrics,
        profit: computeProfit(metrics, profitConfig),
        impressionShare: decimalToNumber(share?._avg.searchImpressionShare),
        budgetLostImpressionShare: budgetLost,
        rankLostImpressionShare: decimalToNumber(share?._avg.searchRankLostImprShare),
        // Google reports lost share against budget; >5% sustained means capped.
        isBudgetLimited: (budgetLost ?? 0) > 0.05 || (budget > 0 && averageDailySpend / budget > 0.95),
        averageDailySpend,
      } satisfies CampaignPerformance;
    })
    .sort((a, b) => b.metrics.cost - a.metrics.cost);
}

export type KeywordPerformance = EntityPerformance<{
  criterionId: string;
  campaignName: string;
  adGroupName: string;
  adGroupId: string;
  campaignRowId: string;
  adGroupRowId: string;
  matchType: string;
  qualityScore: number | null;
  cpcBid: number | null;
}>;

export async function getKeywordPerformance(
  scope: Scope,
  range: { start: string; end: string },
  profitConfig: ProfitConfig,
  options: { limit?: number; minCost?: number; campaignRowId?: string } = {},
): Promise<KeywordPerformance[]> {
  const keywords = await prisma.keyword.findMany({
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      status: { not: "REMOVED" },
      isNegative: false,
      ...(options.campaignRowId ? { campaignRowId: options.campaignRowId } : {}),
    },
    select: {
      id: true,
      criterionId: true,
      text: true,
      status: true,
      matchType: true,
      qualityScore: true,
      cpcBidMicros: true,
      effectiveCpcBidMicros: true,
      campaignRowId: true,
      adGroupRowId: true,
      campaign: { select: { name: true } },
      adGroup: { select: { name: true, adGroupId: true } },
    },
  });

  if (keywords.length === 0) return [];

  const sums = await prisma.dailyMetric.groupBy({
    by: ["keywordRowId"],
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      level: "KEYWORD",
      date: rangeToDates(range),
      keywordRowId: { in: keywords.map((keyword) => keyword.id) },
    },
    _sum: METRIC_SUM,
  });

  const sumByKeyword = new Map(sums.map((row) => [row.keywordRowId, row]));

  const rows = keywords
    .map((keyword) => {
      const metrics = derive(rawFromSum(sumByKeyword.get(keyword.id)));
      return {
        id: keyword.id,
        externalId: keyword.criterionId,
        criterionId: keyword.criterionId,
        name: keyword.text,
        status: keyword.status,
        matchType: keyword.matchType,
        qualityScore: keyword.qualityScore,
        cpcBid: keyword.cpcBidMicros ? toNumber(keyword.cpcBidMicros) / 1_000_000 : null,
        campaignName: keyword.campaign.name,
        adGroupName: keyword.adGroup.name,
        adGroupId: keyword.adGroup.adGroupId,
        campaignRowId: keyword.campaignRowId,
        adGroupRowId: keyword.adGroupRowId,
        metrics,
        profit: computeProfit(metrics, profitConfig),
      } satisfies KeywordPerformance;
    })
    .filter((row) => (options.minCost ? row.metrics.cost >= options.minCost : true))
    .sort((a, b) => b.metrics.cost - a.metrics.cost);

  return options.limit ? rows.slice(0, options.limit) : rows;
}

export type SearchTermPerformance = {
  id: string;
  text: string;
  campaignName: string | null;
  adGroupName: string | null;
  adGroupRowId: string | null;
  campaignRowId: string | null;
  /** Google-side ids — the only ones a mutation may reference. */
  googleAdGroupId: string | null;
  googleCampaignId: string | null;
  triggeredKeyword: string | null;
  status: string;
  intent: string;
  intentReason: string | null;
  metrics: DerivedMetrics;
  profit: ProfitMetrics;
};

export async function getSearchTermPerformance(
  scope: Scope,
  profitConfig: ProfitConfig,
  options: { limit?: number; minCost?: number; onlyUnconverted?: boolean } = {},
): Promise<SearchTermPerformance[]> {
  const terms = await prisma.searchTerm.findMany({
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      ...(options.onlyUnconverted ? { conversions: { lte: 0 } } : {}),
    },
    select: {
      id: true,
      text: true,
      status: true,
      intent: true,
      intentReason: true,
      triggeredKeyword: true,
      campaignRowId: true,
      adGroupRowId: true,
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
      conversionValueMicros: true,
      campaign: { select: { name: true, campaignId: true } },
      adGroup: { select: { name: true, adGroupId: true } },
    },
    orderBy: { costMicros: "desc" },
    take: options.limit ?? 500,
  });

  return terms
    .map((term) => {
      const metrics = derive({
        impressions: toNumber(term.impressions),
        clicks: toNumber(term.clicks),
        costMicros: toNumber(term.costMicros),
        conversions: term.conversions,
        conversionValueMicros: toNumber(term.conversionValueMicros),
      });

      return {
        id: term.id,
        text: term.text,
        campaignName: term.campaign?.name ?? null,
        adGroupName: term.adGroup?.name ?? null,
        campaignRowId: term.campaignRowId,
        adGroupRowId: term.adGroupRowId,
        googleAdGroupId: term.adGroup?.adGroupId ?? null,
        googleCampaignId: term.campaign?.campaignId ?? null,
        triggeredKeyword: term.triggeredKeyword,
        status: term.status,
        intent: term.intent,
        intentReason: term.intentReason,
        metrics,
        profit: computeProfit(metrics, profitConfig),
      } satisfies SearchTermPerformance;
    })
    .filter((term) => (options.minCost ? term.metrics.cost >= options.minCost : true));
}

export type AdPerformance = EntityPerformance<{
  adId: string;
  campaignName: string;
  adGroupName: string;
  adGroupRowId: string;
  googleAdGroupId: string;
  headlines: string[];
  descriptions: string[];
  adStrength: string | null;
  finalUrl: string | null;
}>;

export async function getAdPerformance(
  scope: Scope,
  range: { start: string; end: string },
  profitConfig: ProfitConfig,
  options: { limit?: number } = {},
): Promise<AdPerformance[]> {
  const ads = await prisma.ad.findMany({
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      status: { not: "REMOVED" },
    },
    select: {
      id: true,
      adId: true,
      status: true,
      adStrength: true,
      headlines: true,
      descriptions: true,
      finalUrls: true,
      adGroupRowId: true,
      campaign: { select: { name: true } },
      adGroup: { select: { name: true, adGroupId: true } },
    },
    take: options.limit ?? 200,
  });

  if (ads.length === 0) return [];

  const sums = await prisma.dailyMetric.groupBy({
    by: ["adRowId"],
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      level: "AD",
      date: rangeToDates(range),
      adRowId: { in: ads.map((ad) => ad.id) },
    },
    _sum: METRIC_SUM,
  });

  const sumByAd = new Map(sums.map((row) => [row.adRowId, row]));

  return ads
    .map((ad) => {
      const metrics = derive(rawFromSum(sumByAd.get(ad.id)));
      const headlines = Array.isArray(ad.headlines) ? (ad.headlines as string[]) : [];
      const descriptions = Array.isArray(ad.descriptions) ? (ad.descriptions as string[]) : [];

      return {
        id: ad.id,
        externalId: ad.adId,
        adId: ad.adId,
        name: headlines[0] ?? `Ad ${ad.adId}`,
        status: ad.status,
        campaignName: ad.campaign.name,
        adGroupName: ad.adGroup.name,
        adGroupRowId: ad.adGroupRowId,
        googleAdGroupId: ad.adGroup.adGroupId,
        headlines,
        descriptions,
        adStrength: ad.adStrength,
        finalUrl: ad.finalUrls[0] ?? null,
        metrics,
        profit: computeProfit(metrics, profitConfig),
      } satisfies AdPerformance;
    })
    .sort((a, b) => b.metrics.cost - a.metrics.cost);
}

export type SegmentBreakdown = {
  segmentKey: string;
  segmentLabel: string;
  metrics: DerivedMetrics;
  profit: ProfitMetrics;
};

export async function getSegmentPerformance(
  scope: Scope,
  range: { start: string; end: string },
  segmentType: "DEVICE" | "LOCATION" | "HOUR_OF_DAY" | "DAY_OF_WEEK" | "NETWORK",
  profitConfig: ProfitConfig,
): Promise<SegmentBreakdown[]> {
  const rows = await prisma.segmentPerformance.groupBy({
    by: ["segmentKey", "segmentLabel"],
    where: {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      segmentType,
      date: rangeToDates(range),
    },
    _sum: {
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
      conversionValueMicros: true,
    },
    orderBy: { segmentKey: "asc" },
  });

  return rows.map((row) => {
    const metrics = derive({
      impressions: toNumber(row._sum.impressions ?? 0),
      clicks: toNumber(row._sum.clicks ?? 0),
      costMicros: toNumber(row._sum.costMicros ?? 0),
      conversions: row._sum.conversions ?? 0,
      conversionValueMicros: toNumber(row._sum.conversionValueMicros ?? 0),
    });
    return {
      segmentKey: row.segmentKey,
      segmentLabel: row.segmentLabel,
      metrics,
      profit: computeProfit(metrics, profitConfig),
    };
  });
}

export type ConversionBreakdown = {
  id: string;
  name: string;
  category: string | null;
  primaryForGoal: boolean;
  includeInConversionsMetric: boolean;
  conversions: number;
  conversionValue: number;
};

export async function getConversionPerformance(scope: Scope): Promise<ConversionBreakdown[]> {
  const rows = await prisma.conversion.findMany({
    where: { organizationId: scope.organizationId, accountId: scope.accountId },
    orderBy: { conversions: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    primaryForGoal: row.primaryForGoal,
    includeInConversionsMetric: row.includeInConversionsMetric,
    conversions: row.conversions,
    conversionValue: toNumber(row.conversionValueMicros) / 1_000_000,
  }));
}

// ---------------------------------------------------------------------------
// Account overview used by the dashboard header and the AI context builder
// ---------------------------------------------------------------------------

export type AccountOverview = {
  comparison: PeriodComparison;
  series: TimeSeriesPoint[];
  campaigns: CampaignPerformance[];
  settings: AccountSettings;
};

export async function getAccountOverview(
  scope: Scope,
  range: DateRange,
): Promise<AccountOverview> {
  const settings = await getAccountSettings(scope);
  const profitConfig = profitConfigFrom(settings);

  const [comparison, series, campaigns] = await Promise.all([
    getPeriodComparison(scope, range, profitConfig),
    getTimeSeries(scope, range, profitConfig),
    getCampaignPerformance(scope, range, profitConfig),
  ]);

  return { comparison, series, campaigns, settings };
}
