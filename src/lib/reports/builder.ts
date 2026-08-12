import "server-only";

import type { DateRange } from "@/lib/analytics/date-range";
import type { Delta, DerivedMetrics, ProfitMetrics } from "@/lib/analytics/metrics";
import {
  getCampaignPerformance,
  getKeywordPerformance,
  getPeriodComparison,
  getSearchTermPerformance,
  getSegmentPerformance,
  getTimeSeries,
  type AccountSettings,
  type Scope,
  type TimeSeriesPoint,
} from "@/lib/analytics/queries";
import { profitConfigFrom } from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";

/**
 * Report assembly.
 *
 * One function gathers everything a period report needs so the page, a future PDF
 * export and the emailed digest all describe the same account in the same numbers.
 */

export type ReportRow = {
  name: string;
  detail: string;
  cost: number;
  conversions: number;
  conversionValue: number;
  roas: number | null;
  cpa: number | null;
  profit: number;
};

export type Report = {
  range: { start: string; end: string; label: string };
  comparison: { start: string; end: string };
  current: DerivedMetrics;
  previous: DerivedMetrics;
  profit: ProfitMetrics;
  deltas: Record<string, Delta>;
  series: TimeSeriesPoint[];
  topCampaigns: ReportRow[];
  topKeywords: ReportRow[];
  worstKeywords: ReportRow[];
  wastedTerms: ReportRow[];
  devices: { label: string; cost: number; conversions: number; roas: number | null }[];
  wastedSpend: number;
  actions: {
    applied: number;
    pending: number;
    rejected: number;
    recent: { title: string; targetName: string; at: Date | null; actor: string }[];
  };
  hasProfitModel: boolean;
};

export async function buildReport(
  scope: Scope,
  range: DateRange,
  settings: AccountSettings,
): Promise<Report> {
  const profitConfig = profitConfigFrom(settings);

  const [comparison, series, campaigns, keywords, searchTerms, devices, actionRows, counts] =
    await Promise.all([
      getPeriodComparison(scope, range, profitConfig),
      getTimeSeries(scope, range, profitConfig),
      getCampaignPerformance(scope, range, profitConfig),
      getKeywordPerformance(scope, range, profitConfig, { limit: 500 }),
      getSearchTermPerformance(scope, profitConfig, { limit: 300, onlyUnconverted: true }),
      getSegmentPerformance(scope, range, "DEVICE", profitConfig),
      prisma.aIAction.findMany({
        where: { ...scope, status: "SUCCEEDED", executedAt: { not: null } },
        orderBy: { executedAt: "desc" },
        take: 10,
        select: { type: true, targetName: true, executedAt: true, actorType: true },
      }),
      prisma.aIRecommendation.groupBy({
        by: ["status"],
        where: scope,
        _count: { _all: true },
      }),
    ]);

  const countFor = (status: string) =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  const toRow = (
    name: string,
    detail: string,
    metrics: DerivedMetrics,
    profit: ProfitMetrics,
  ): ReportRow => ({
    name,
    detail,
    cost: metrics.cost,
    conversions: metrics.conversions,
    conversionValue: metrics.conversionValue,
    roas: metrics.roas,
    cpa: metrics.cpa,
    profit: profit.netProfit,
  });

  const campaignRows = campaigns
    .map((campaign) => toRow(campaign.name, campaign.advertisingChannel, campaign.metrics, campaign.profit))
    .sort((a, b) => b.conversionValue - a.conversionValue || b.cost - a.cost)
    .slice(0, 8);

  const keywordRows = keywords.map((keyword) =>
    toRow(keyword.name, `${keyword.matchType} · ${keyword.campaignName}`, keyword.metrics, keyword.profit),
  );

  const topKeywords = [...keywordRows]
    .filter((row) => row.conversions > 0)
    .sort((a, b) => b.conversionValue - a.conversionValue)
    .slice(0, 8);

  const worstKeywords = [...keywordRows]
    .filter((row) => row.conversions === 0 && row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  const wastedTerms = searchTerms
    .map((term) =>
      toRow(term.text, term.campaignName ?? "—", term.metrics, term.profit),
    )
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return {
    range: { start: range.start, end: range.end, label: range.label },
    comparison: comparison.comparison,
    current: comparison.current,
    previous: comparison.previous,
    profit: comparison.currentProfit,
    deltas: comparison.deltas,
    series,
    topCampaigns: campaignRows,
    topKeywords,
    worstKeywords,
    wastedTerms,
    devices: devices.map((device) => ({
      label: device.segmentLabel,
      cost: device.metrics.cost,
      conversions: device.metrics.conversions,
      roas: device.metrics.roas,
    })),
    wastedSpend: searchTerms.reduce((total, term) => total + term.metrics.cost, 0),
    actions: {
      applied: countFor("EXECUTED"),
      pending: countFor("PENDING"),
      rejected: countFor("REJECTED") + countFor("IGNORED"),
      recent: actionRows.map((action) => ({
        title: action.type.charAt(0) + action.type.slice(1).toLowerCase().replace(/_/g, " "),
        targetName: action.targetName,
        at: action.executedAt,
        actor: action.actorType === "AI" ? "AI Agent" : "Team member",
      })),
    },
    hasProfitModel: settings.grossMarginPct !== null || settings.leadValue !== null,
  };
}
