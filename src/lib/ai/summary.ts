import "server-only";

import { accountSummarySchema, type AccountSummary } from "@/lib/ai/schemas";
import { structuredWithFallback } from "@/lib/ai/provider";
import { resolveRange } from "@/lib/analytics/date-range";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/analytics/format";
import {
  getAccountSettings,
  getCampaignPerformance,
  getKeywordPerformance,
  getPeriodComparison,
  getSearchTermPerformance,
  profitConfigFrom,
  type CampaignPerformance,
  type KeywordPerformance,
  type PeriodComparison,
  type SearchTermPerformance,
} from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";

/**
 * The "AI Account Summary" card.
 *
 * Every number in the output is computed here and injected into the prompt as text the
 * model is only allowed to reuse. The deterministic version is a complete, shippable
 * summary on its own — the model makes it read better, it does not make it true.
 *
 * Results are cached on the account row, so opening the dashboard never triggers an
 * LLM call.
 */

const log = createLogger("ai.summary");

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export type StoredSummary = AccountSummary & {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  usedModel: boolean;
};

export async function getAccountSummary(
  organizationId: string,
  accountId: string,
  options: { force?: boolean } = {},
): Promise<StoredSummary | null> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId },
    select: {
      id: true,
      descriptiveName: true,
      currencyCode: true,
      timeZone: true,
      summary: true,
      summaryAt: true,
      lastSyncedAt: true,
    },
  });
  if (!account) return null;

  const fresh =
    account.summaryAt !== null && Date.now() - account.summaryAt.getTime() < CACHE_TTL_MS;

  if (!options.force && fresh && account.summary) {
    return account.summary as unknown as StoredSummary;
  }

  if (!account.lastSyncedAt) return null;

  const summary = await buildSummary(organizationId, account);

  await prisma.googleAdsAccount
    .update({
      where: { id: accountId },
      data: { summary: summary as unknown as object, summaryAt: new Date() },
    })
    .catch((error: unknown) => log.warn("failed to cache summary", { error, accountId }));

  return summary;
}

async function buildSummary(
  organizationId: string,
  account: { id: string; descriptiveName: string; currencyCode: string; timeZone: string },
): Promise<StoredSummary> {
  const scope = { organizationId, accountId: account.id };
  const settings = await getAccountSettings(scope);
  const profitConfig = profitConfigFrom(settings);
  const range = resolveRange("last_30", account.timeZone);

  const [comparison, campaigns, keywords, searchTerms] = await Promise.all([
    getPeriodComparison(scope, range, profitConfig),
    getCampaignPerformance(scope, range, profitConfig),
    getKeywordPerformance(scope, range, profitConfig, { limit: 100 }),
    getSearchTermPerformance(scope, profitConfig, { limit: 100 }),
  ]);

  const facts = collectFacts({
    currency: account.currencyCode,
    // Profit is only worth showing once the user has told us their margin.
    hasProfitModel: settings.grossMarginPct !== null || settings.leadValue !== null,
    comparison,
    campaigns,
    keywords,
    searchTerms,
  });
  const deterministic = deterministicSummary(facts);

  const { data, usedModel } = await structuredWithFallback({
    system: SUMMARY_SYSTEM,
    user: buildPrompt(account.descriptiveName, account.currencyCode, facts),
    schema: accountSummarySchema,
    schemaName: "account_summary",
    temperature: 0.3,
    maxTokens: 900,
    fallback: () => deterministic,
  });

  return {
    ...data,
    generatedAt: new Date().toISOString(),
    rangeStart: range.start,
    rangeEnd: range.end,
    usedModel,
  };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

type Facts = {
  currency: string;
  hasData: boolean;
  spend: string;
  revenue: string;
  conversions: string;
  roas: string | null;
  roasChange: string | null;
  cpa: string | null;
  profit: string | null;
  spendChange: string | null;
  conversionChange: string | null;
  opportunity: { name: string; roas: string; budget: string; reason: string } | null;
  waste: { name: string; spend: string; clicks: number; kind: "search term" | "keyword" } | null;
  budgetLimited: string[];
};

function collectFacts(input: {
  currency: string;
  hasProfitModel: boolean;
  comparison: PeriodComparison;
  campaigns: CampaignPerformance[];
  keywords: KeywordPerformance[];
  searchTerms: SearchTermPerformance[];
}): Facts {
  const { currency, comparison, campaigns, keywords, searchTerms } = input;
  const money = (value: number) => formatCurrency(value, currency);
  const pct = (value: number | null) =>
    value === null ? null : formatPercent(value, { signed: true });

  const current = comparison.current;

  // The best opportunity is a campaign that performs well and cannot spend more.
  const opportunityCampaign = campaigns
    .filter((campaign) => campaign.isBudgetLimited && (campaign.metrics.roas ?? 0) >= 2)
    .sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0))[0];

  const wasteTerm = searchTerms
    .filter((term) => term.metrics.conversions === 0 && term.metrics.cost > 0)
    .sort((a, b) => b.metrics.cost - a.metrics.cost)[0];

  const wasteKeyword = keywords
    .filter((keyword) => keyword.metrics.conversions === 0 && keyword.metrics.cost > 0)
    .sort((a, b) => b.metrics.cost - a.metrics.cost)[0];

  const worstWaste =
    wasteTerm && wasteKeyword
      ? wasteTerm.metrics.cost >= wasteKeyword.metrics.cost
        ? { row: wasteTerm, kind: "search term" as const }
        : { row: wasteKeyword, kind: "keyword" as const }
      : wasteTerm
        ? { row: wasteTerm, kind: "search term" as const }
        : wasteKeyword
          ? { row: wasteKeyword, kind: "keyword" as const }
          : null;

  return {
    currency,
    hasData: current.cost > 0 || current.impressions > 0,
    spend: money(current.cost),
    revenue: money(current.conversionValue),
    conversions: formatNumber(current.conversions, { decimals: current.conversions % 1 === 0 ? 0 : 1 }),
    roas: current.roas === null ? null : `${current.roas.toFixed(2)}x`,
    roasChange: pct(comparison.deltas.roas.percent),
    cpa: current.cpa === null ? null : money(current.cpa),
    profit: input.hasProfitModel ? money(comparison.currentProfit.netProfit) : null,
    spendChange: pct(comparison.deltas.cost.percent),
    conversionChange: pct(comparison.deltas.conversions.percent),
    opportunity: opportunityCampaign
      ? {
          name: opportunityCampaign.name,
          roas: `${(opportunityCampaign.metrics.roas ?? 0).toFixed(2)}x`,
          budget: money(opportunityCampaign.budget),
          reason: "limited by budget",
        }
      : null,
    waste: worstWaste
      ? {
          name: worstWaste.kind === "search term" ? worstWaste.row.text : worstWaste.row.name,
          spend: money(worstWaste.row.metrics.cost),
          clicks: worstWaste.row.metrics.clicks,
          kind: worstWaste.kind,
        }
      : null,
    budgetLimited: campaigns
      .filter((campaign) => campaign.isBudgetLimited)
      .slice(0, 3)
      .map((campaign) => campaign.name),
  };
}

// ---------------------------------------------------------------------------
// Deterministic summary — also the fallback when no model is configured
// ---------------------------------------------------------------------------

function deterministicSummary(facts: Facts): AccountSummary {
  if (!facts.hasData) {
    return {
      headline: "Not enough data yet",
      summary:
        "This account has no recorded spend or impressions in the last 30 days, so there is nothing to analyze. Once traffic starts, a full summary appears here automatically.",
      biggestOpportunity: "Insufficient data.",
      biggestWaste: "Insufficient data.",
      watchOut: null,
      insights: [],
    };
  }

  const parts: string[] = [
    `Your account generated ${facts.revenue} in conversion value from ${facts.spend} in spend over the last 30 days, across ${facts.conversions} conversions.`,
  ];

  if (facts.roas) {
    parts.push(
      facts.roasChange
        ? `ROAS is ${facts.roas}, ${describeChange(facts.roasChange)} against the previous 30 days.`
        : `ROAS is ${facts.roas}.`,
    );
  }
  if (facts.profit) parts.push(`Estimated profit after cost of goods is ${facts.profit}.`);

  const opportunity = facts.opportunity
    ? `${facts.opportunity.name} is ${facts.opportunity.reason} at ${facts.opportunity.budget} per day while returning ${facts.opportunity.roas}. Raising that budget is the clearest way to buy more of what already works.`
    : "No campaign is currently held back by its budget, so there is no obvious scaling opportunity this period.";

  const waste = facts.waste
    ? `The ${facts.waste.kind} "${facts.waste.name}" spent ${facts.waste.spend} across ${facts.waste.clicks} clicks without producing a conversion.`
    : "No single keyword or search term stands out as wasted spend this period.";

  const insights: string[] = [];
  if (facts.spendChange) insights.push(`Spend ${describeChange(facts.spendChange)} versus the previous 30 days.`);
  if (facts.conversionChange)
    insights.push(`Conversions ${describeChange(facts.conversionChange)} versus the previous 30 days.`);
  if (facts.cpa) insights.push(`Average cost per conversion is ${facts.cpa}.`);
  if (facts.budgetLimited.length > 0)
    insights.push(`Budget limited: ${facts.budgetLimited.join(", ")}.`);

  return {
    headline: facts.roas
      ? `${facts.revenue} from ${facts.spend} at ${facts.roas} ROAS`
      : `${facts.spend} spent over the last 30 days`,
    summary: parts.join(" "),
    biggestOpportunity: opportunity,
    biggestWaste: waste,
    watchOut:
      facts.conversionChange && facts.conversionChange.startsWith("-")
        ? `Conversions ${describeChange(facts.conversionChange)}. Confirm tracking is intact before making bid or budget changes.`
        : null,
    insights: insights.slice(0, 5),
  };
}

function describeChange(formatted: string): string {
  const isDown = formatted.trim().startsWith("-");
  return `${isDown ? "down" : "up"} ${formatted.replace(/^[+-]/, "")}`;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM = `You write the account summary shown at the top of a Google Ads dashboard.

Absolute rules:
- Use only the figures provided. Never compute, estimate, round differently, or invent a number.
- If a figure is marked unavailable, say so plainly. Never guess.
- Write for a business owner, not an ads specialist. Plain English, complete sentences, no jargon, no emoji, no exclamation marks.
- Be specific about what changed and what to do about it. Avoid empty phrases like "performance is looking good".
- The summary is 2 to 4 sentences.
- biggestOpportunity and biggestWaste must each name a specific campaign, keyword or search term from the input, or say "Insufficient data."
- watchOut is null unless there is a genuine problem worth interrupting someone for.
- insights are at most 5 short factual statements, each mentioning a figure from the input.`;

function buildPrompt(accountName: string, currency: string, facts: Facts): string {
  const lines = [
    `Account: ${accountName}`,
    `Currency: ${currency}`,
    `Period: last 30 days, compared with the 30 days before it`,
    "",
    "Figures (use verbatim):",
    `- Spend: ${facts.spend}${facts.spendChange ? ` (${facts.spendChange} vs previous period)` : ""}`,
    `- Conversion value: ${facts.revenue}`,
    `- Conversions: ${facts.conversions}${
      facts.conversionChange ? ` (${facts.conversionChange} vs previous period)` : ""
    }`,
    `- ROAS: ${facts.roas ?? "unavailable"}${facts.roasChange ? ` (${facts.roasChange} vs previous period)` : ""}`,
    `- CPA: ${facts.cpa ?? "unavailable"}`,
    `- Estimated profit: ${facts.profit ?? "unavailable (no margin configured)"}`,
  ];

  if (facts.opportunity) {
    lines.push(
      `- Best opportunity: campaign "${facts.opportunity.name}", ROAS ${facts.opportunity.roas}, budget ${facts.opportunity.budget}/day, ${facts.opportunity.reason}`,
    );
  } else {
    lines.push("- Best opportunity: none identified");
  }

  if (facts.waste) {
    lines.push(
      `- Biggest waste: ${facts.waste.kind} "${facts.waste.name}", ${facts.waste.spend} spent, ${facts.waste.clicks} clicks, 0 conversions`,
    );
  } else {
    lines.push("- Biggest waste: none identified");
  }

  if (facts.budgetLimited.length > 0) {
    lines.push(`- Budget limited campaigns: ${facts.budgetLimited.join(", ")}`);
  }

  return lines.join("\n");
}

/** Called after a sync or analysis so the next dashboard load is already warm. */
export async function invalidateAccountSummary(accountId: string): Promise<void> {
  await prisma.googleAdsAccount
    .update({ where: { id: accountId }, data: { summaryAt: null } })
    .catch(() => undefined);
}
