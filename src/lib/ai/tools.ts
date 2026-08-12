import "server-only";

import { z } from "zod";

import type { ToolDefinition } from "@/lib/ai/provider";
import { resolveRange, type RangePreset } from "@/lib/analytics/date-range";
import { formatCurrency, formatDecimal, formatPercent } from "@/lib/analytics/format";
import {
  getAccountSettings,
  getAdPerformance,
  getCampaignPerformance,
  getConversionPerformance,
  getKeywordPerformance,
  getPeriodComparison,
  getSearchTermPerformance,
  getSegmentPerformance,
  getTimeSeries,
  profitConfigFrom,
} from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";

/**
 * The agent's tool surface.
 *
 * This is the complete list of things the model is allowed to do. It is read-only by
 * construction: there is no tool that writes to Google Ads. When the model wants a
 * change, it says so in prose and the user acts on a recommendation that the rule
 * engine produced and the safety engine validated.
 *
 * Arguments are parsed with Zod before execution, and every query is scoped to the
 * organization and account on the context — never to anything the model supplies.
 */

const log = createLogger("ai.tools");

export type ToolContext = {
  organizationId: string;
  accountId: string;
  currency: string;
  timeZone: string;
};

type ToolHandler<TArgs> = (context: ToolContext, args: TArgs) => Promise<unknown>;

type Tool<TArgs = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  handler: ToolHandler<TArgs>;
};

const periodSchema = z
  .enum(["today", "yesterday", "last_7", "last_14", "last_30", "last_90", "this_month", "last_month"])
  .default("last_30")
  .describe("Time period to analyze.");

function defineTool<TArgs>(tool: Tool<TArgs>): Tool<unknown> {
  return tool as unknown as Tool<unknown>;
}

async function resolveContext(context: ToolContext, period: RangePreset) {
  const settings = await getAccountSettings(context);
  return {
    scope: { organizationId: context.organizationId, accountId: context.accountId },
    settings,
    profitConfig: profitConfigFrom(settings),
    range: resolveRange(period, context.timeZone),
  };
}

/** Compact rows keep token usage predictable; the model gets facts, not raw dumps. */
function money(value: number | null, currency: string): string {
  return value === null ? "n/a" : formatCurrency(value, currency, { decimals: 2 });
}

function ratio(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}x`;
}

function percent(value: number | null): string {
  return value === null ? "n/a" : formatPercent(value);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getAccountOverview = defineTool({
  name: "getAccountOverview",
  description:
    "Headline performance for the account over a period, with the change versus the previous period of equal length. Use this first for any question about how the account is doing.",
  schema: z.object({ period: periodSchema }).strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range, settings } = await resolveContext(context, args.period);
    const comparison = await getPeriodComparison(scope, range, profitConfig);
    const { current, previous, deltas, currentProfit } = comparison;

    return {
      period: { start: range.start, end: range.end, label: range.label },
      comparisonPeriod: comparison.comparison,
      current: {
        spend: money(current.cost, context.currency),
        conversions: formatDecimal(current.conversions, 1),
        conversionValue: money(current.conversionValue, context.currency),
        roas: ratio(current.roas),
        cpa: money(current.cpa, context.currency),
        conversionRate: percent(current.conversionRate),
        clicks: current.clicks,
        impressions: current.impressions,
        ctr: percent(current.ctr),
        cpc: money(current.cpc, context.currency),
        estimatedProfit:
          settings.grossMarginPct === null && settings.leadValue === null
            ? "not configured"
            : money(currentProfit.netProfit, context.currency),
      },
      previous: {
        spend: money(previous.cost, context.currency),
        conversions: formatDecimal(previous.conversions, 1),
        conversionValue: money(previous.conversionValue, context.currency),
        roas: ratio(previous.roas),
        cpa: money(previous.cpa, context.currency),
      },
      changeVsPreviousPeriod: Object.fromEntries(
        Object.entries(deltas).map(([key, delta]) => [
          key,
          delta.percent === null ? "n/a" : formatPercent(delta.percent, { signed: true }),
        ]),
      ),
      targets: { targetRoas: settings.targetRoas, targetCpa: settings.targetCpa },
    };
  },
});

const getCampaigns = defineTool({
  name: "getCampaignPerformance",
  description:
    "Performance for every campaign in the period, including daily budget and whether the campaign is limited by budget. Use for questions about which campaigns work, where to move budget, or why spend changed.",
  schema: z
    .object({
      period: periodSchema,
      limit: z.number().int().min(1).max(50).default(20),
      onlyBudgetLimited: z.boolean().default(false),
    })
    .strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range } = await resolveContext(context, args.period);
    const campaigns = await getCampaignPerformance(scope, range, profitConfig);

    const filtered = args.onlyBudgetLimited
      ? campaigns.filter((campaign) => campaign.isBudgetLimited)
      : campaigns;

    return {
      period: { start: range.start, end: range.end },
      campaigns: filtered.slice(0, args.limit).map((campaign) => ({
        name: campaign.name,
        status: campaign.status,
        channel: campaign.advertisingChannel,
        dailyBudget: money(campaign.budget, context.currency),
        budgetLimited: campaign.isBudgetLimited,
        spend: money(campaign.metrics.cost, context.currency),
        conversions: formatDecimal(campaign.metrics.conversions, 1),
        conversionValue: money(campaign.metrics.conversionValue, context.currency),
        roas: ratio(campaign.metrics.roas),
        cpa: money(campaign.metrics.cpa, context.currency),
        ctr: percent(campaign.metrics.ctr),
        searchImpressionShare: percent(campaign.impressionShare),
        impressionShareLostToBudget: percent(campaign.budgetLostImpressionShare),
      })),
    };
  },
});

const getKeywords = defineTool({
  name: "getKeywordPerformance",
  description:
    "Keyword-level performance. Use for questions about which keywords make or lose money, bids, quality score, or match types. Sorted by spend.",
  schema: z
    .object({
      period: periodSchema,
      limit: z.number().int().min(1).max(50).default(20),
      onlyWithoutConversions: z.boolean().default(false),
      minSpend: z.number().min(0).default(0),
    })
    .strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range } = await resolveContext(context, args.period);
    const keywords = await getKeywordPerformance(scope, range, profitConfig, {
      minCost: args.minSpend,
    });

    const filtered = args.onlyWithoutConversions
      ? keywords.filter((keyword) => keyword.metrics.conversions === 0)
      : keywords;

    return {
      period: { start: range.start, end: range.end },
      totalKeywords: keywords.length,
      keywords: filtered.slice(0, args.limit).map((keyword) => ({
        keyword: keyword.name,
        matchType: keyword.matchType,
        status: keyword.status,
        campaign: keyword.campaignName,
        adGroup: keyword.adGroupName,
        qualityScore: keyword.qualityScore,
        currentBid: money(keyword.cpcBid, context.currency),
        spend: money(keyword.metrics.cost, context.currency),
        clicks: keyword.metrics.clicks,
        conversions: formatDecimal(keyword.metrics.conversions, 1),
        conversionValue: money(keyword.metrics.conversionValue, context.currency),
        roas: ratio(keyword.metrics.roas),
        cpa: money(keyword.metrics.cpa, context.currency),
      })),
    };
  },
});

const getSearchTerms = defineTool({
  name: "getSearchTerms",
  description:
    "Actual queries people typed, with performance and the intent classification. Use for questions about wasted spend, negative keywords, or new keyword opportunities.",
  schema: z
    .object({
      limit: z.number().int().min(1).max(50).default(20),
      onlyWithoutConversions: z.boolean().default(false),
      minSpend: z.number().min(0).default(0),
    })
    .strict(),
  handler: async (context, args) => {
    const { scope, profitConfig } = await resolveContext(context, "last_30");
    const terms = await getSearchTermPerformance(scope, profitConfig, {
      minCost: args.minSpend,
      onlyUnconverted: args.onlyWithoutConversions,
    });

    const wasted = terms
      .filter((term) => term.metrics.conversions === 0)
      .reduce((total, term) => total + term.metrics.cost, 0);

    return {
      note: "Search term data covers the account's configured lookback window.",
      totalWastedSpendWithoutConversions: money(wasted, context.currency),
      searchTerms: terms.slice(0, args.limit).map((term) => ({
        searchTerm: term.text,
        campaign: term.campaignName,
        adGroup: term.adGroupName,
        matchedKeyword: term.triggeredKeyword,
        intent: term.intent,
        status: term.status,
        spend: money(term.metrics.cost, context.currency),
        clicks: term.metrics.clicks,
        conversions: formatDecimal(term.metrics.conversions, 1),
        conversionValue: money(term.metrics.conversionValue, context.currency),
        roas: ratio(term.metrics.roas),
      })),
    };
  },
});

const getAds = defineTool({
  name: "getAdPerformance",
  description:
    "Ad creative performance including headlines and ad strength. Use for questions about which ads work or what copy to test.",
  schema: z
    .object({ period: periodSchema, limit: z.number().int().min(1).max(30).default(10) })
    .strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range } = await resolveContext(context, args.period);
    const ads = await getAdPerformance(scope, range, profitConfig);

    return {
      period: { start: range.start, end: range.end },
      ads: ads.slice(0, args.limit).map((ad) => ({
        adGroup: ad.adGroupName,
        campaign: ad.campaignName,
        status: ad.status,
        adStrength: ad.adStrength,
        headlines: ad.headlines.slice(0, 5),
        spend: money(ad.metrics.cost, context.currency),
        clicks: ad.metrics.clicks,
        ctr: percent(ad.metrics.ctr),
        conversions: formatDecimal(ad.metrics.conversions, 1),
        conversionRate: percent(ad.metrics.conversionRate),
        roas: ratio(ad.metrics.roas),
      })),
    };
  },
});

const getSegments = defineTool({
  name: "getSegmentPerformance",
  description:
    "Performance broken down by device, location, hour of day, day of week, or network. Use for questions about when or where the account performs best.",
  schema: z
    .object({
      period: periodSchema,
      segment: z.enum(["DEVICE", "LOCATION", "HOUR_OF_DAY", "DAY_OF_WEEK", "NETWORK"]),
    })
    .strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range } = await resolveContext(context, args.period);
    const rows = await getSegmentPerformance(scope, range, args.segment, profitConfig);

    return {
      period: { start: range.start, end: range.end },
      segment: args.segment,
      rows: rows.slice(0, 30).map((row) => ({
        label: row.segmentLabel,
        spend: money(row.metrics.cost, context.currency),
        clicks: row.metrics.clicks,
        conversions: formatDecimal(row.metrics.conversions, 1),
        roas: ratio(row.metrics.roas),
        cpa: money(row.metrics.cpa, context.currency),
        conversionRate: percent(row.metrics.conversionRate),
      })),
    };
  },
});

const getConversions = defineTool({
  name: "getConversionPerformance",
  description:
    "Conversion actions configured on the account and how many each recorded. Use to diagnose tracking problems or to explain what a conversion means for this account.",
  schema: z.object({}).strict(),
  handler: async (context) => {
    const conversions = await getConversionPerformance({
      organizationId: context.organizationId,
      accountId: context.accountId,
    });

    return {
      conversionActions: conversions.map((conversion) => ({
        name: conversion.name,
        category: conversion.category,
        primaryForGoal: conversion.primaryForGoal,
        includedInConversionsMetric: conversion.includeInConversionsMetric,
        conversions: formatDecimal(conversion.conversions, 1),
        conversionValue: money(conversion.conversionValue, context.currency),
      })),
    };
  },
});

const getTrend = defineTool({
  name: "getPerformanceTrend",
  description:
    "Daily time series for the account. Use to answer questions about when something changed or to spot a trend inside a period.",
  schema: z.object({ period: periodSchema }).strict(),
  handler: async (context, args) => {
    const { scope, profitConfig, range } = await resolveContext(context, args.period);
    const series = await getTimeSeries(scope, range, profitConfig);

    return {
      period: { start: range.start, end: range.end },
      days: series.map((point) => ({
        date: point.date,
        spend: Number(point.cost.toFixed(2)),
        clicks: point.clicks,
        conversions: Number(point.conversions.toFixed(1)),
        conversionValue: Number(point.conversionValue.toFixed(2)),
        roas: point.roas === null ? null : Number(point.roas.toFixed(2)),
      })),
    };
  },
});

const getOpenRecommendations = defineTool({
  name: "getRecommendations",
  description:
    "Optimization recommendations the engine has already produced for this account, with the reason and expected impact. Use when asked what to do next or what to change today.",
  schema: z.object({ limit: z.number().int().min(1).max(25).default(10) }).strict(),
  handler: async (context, args) => {
    const rows = await prisma.aIRecommendation.findMany({
      where: {
        organizationId: context.organizationId,
        accountId: context.accountId,
        status: "PENDING",
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: args.limit,
      select: {
        type: true,
        targetName: true,
        title: true,
        reason: true,
        expectedImpact: true,
        risk: true,
        confidence: true,
        estimatedMonthlyImpact: true,
      },
    });

    return {
      pendingRecommendations: rows.map((row) => ({
        type: row.type,
        target: row.targetName,
        title: row.title,
        reason: row.reason,
        expectedImpact: row.expectedImpact,
        risk: row.risk,
        confidence: Number(row.confidence),
        estimatedMonthlyImpact:
          row.estimatedMonthlyImpact === null
            ? null
            : money(Number(row.estimatedMonthlyImpact), context.currency),
      })),
    };
  },
});

const getAlerts = defineTool({
  name: "getAnomalies",
  description:
    "Open alerts detected by the anomaly scanner, such as spend spikes, ROAS drops or tracking problems. Use when asked what went wrong or what happened this week.",
  schema: z.object({}).strict(),
  handler: async (context) => {
    const rows = await prisma.anomaly.findMany({
      where: {
        organizationId: context.organizationId,
        accountId: context.accountId,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        type: true,
        title: true,
        description: true,
        severity: true,
        entityName: true,
        changePct: true,
        periodStart: true,
        periodEnd: true,
      },
    });

    return {
      openAlerts: rows.map((row) => ({
        type: row.type,
        severity: row.severity,
        entity: row.entityName,
        title: row.title,
        description: row.description,
        changePct: `${Number(row.changePct).toFixed(1)}%`,
      })),
    };
  },
});

const getRecentChanges = defineTool({
  name: "getRecentChanges",
  description:
    "Changes the optimizer has already applied to this account, newest first. Use when asked what the AI has done.",
  schema: z.object({ limit: z.number().int().min(1).max(25).default(10) }).strict(),
  handler: async (context, args) => {
    const rows = await prisma.aIAction.findMany({
      where: {
        organizationId: context.organizationId,
        accountId: context.accountId,
        status: { in: ["SUCCEEDED", "ROLLED_BACK"] },
      },
      orderBy: { executedAt: "desc" },
      take: args.limit,
      select: {
        type: true,
        targetName: true,
        status: true,
        actorType: true,
        executedAt: true,
        payload: true,
      },
    });

    return {
      appliedChanges: rows.map((row) => ({
        type: row.type,
        target: row.targetName,
        status: row.status,
        appliedBy: row.actorType === "AI" ? "AI Agent" : "User",
        appliedAt: row.executedAt?.toISOString() ?? null,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOLS: Tool<unknown>[] = [
  getAccountOverview,
  getCampaigns,
  getKeywords,
  getSearchTerms,
  getAds,
  getSegments,
  getConversions,
  getTrend,
  getOpenRecommendations,
  getAlerts,
  getRecentChanges,
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>,
  }));
}

export type ToolExecution = {
  name: string;
  ok: boolean;
  result: unknown;
};

/**
 * Executes a tool the model asked for. An unknown name, malformed arguments or a
 * failing query all resolve to a structured error the model can read — never an
 * exception that breaks the conversation, and never an arbitrary call.
 */
export async function executeTool(
  context: ToolContext,
  name: string,
  rawArguments: string,
): Promise<ToolExecution> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    log.warn("model requested an unknown tool", { name });
    return { name, ok: false, result: { error: `Unknown tool "${name}".` } };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = rawArguments.trim().length > 0 ? JSON.parse(rawArguments) : {};
  } catch {
    return { name, ok: false, result: { error: "Arguments were not valid JSON." } };
  }

  const validated = tool.schema.safeParse(parsedArguments);
  if (!validated.success) {
    return {
      name,
      ok: false,
      result: {
        error: "Arguments did not match the tool schema.",
        issues: validated.error.issues.slice(0, 4).map((issue) => issue.message),
      },
    };
  }

  try {
    const result = await tool.handler(context, validated.data);
    return { name, ok: true, result };
  } catch (error) {
    log.error("tool execution failed", { name, error });
    return { name, ok: false, result: { error: "That data could not be loaded right now." } };
  }
}

export function toolNames(): string[] {
  return TOOLS.map((tool) => tool.name);
}
