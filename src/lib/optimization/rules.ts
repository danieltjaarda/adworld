import type {
  RecommendationTargetType,
  RecommendationType,
  RiskLevel,
} from "@/generated/prisma/enums";
import type { ActionPayload, Evidence } from "@/lib/ai/schemas";
import { assessDataSufficiency, type DerivedMetrics, type ProfitMetrics } from "@/lib/analytics/metrics";
import type {
  AccountSettings,
  AdPerformance,
  CampaignPerformance,
  KeywordPerformance,
  SearchTermPerformance,
} from "@/lib/analytics/queries";
import { classifySearchTerm } from "@/lib/optimization/search-term-intent";
import { clampBid, clampBudget, relativeGap, scoreConfidence, scoreRisk } from "@/lib/optimization/safety";
import { stableHash } from "@/lib/security/crypto";
import { safeDivide } from "@/lib/utils";

/**
 * The rule engine.
 *
 * Deterministic analysis produces every candidate change, with the numbers already
 * computed and the safety limits already applied. The LLM only ever adds language and
 * ordering on top of this — it cannot introduce a change the rules did not justify.
 */

export type Candidate = {
  type: RecommendationType;
  targetType: RecommendationTargetType;
  targetId: string;
  targetName: string;
  payload: ActionPayload;
  evidence: Evidence;
  /** Deterministic fallback copy, used verbatim when no model is configured. */
  title: string;
  reason: string;
  expectedImpact: string;
  confidence: number;
  risk: RiskLevel;
  priority: number;
  estimatedMonthlyImpact: number;
  dedupeKey: string;
};

export type RuleContext = {
  settings: AccountSettings;
  currency: string;
  window: { start: string; end: string; days: number };
  accountMetrics: DerivedMetrics;
  accountProfit: ProfitMetrics;
  campaigns: CampaignPerformance[];
  keywords: KeywordPerformance[];
  searchTerms: SearchTermPerformance[];
  ads: AdPerformance[];
  existingNegatives: Set<string>;
  existingKeywords: Set<string>;
};

const DAYS_PER_MONTH = 30.4;

function monthlyFrom(value: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.round((value / windowDays) * DAYS_PER_MONTH * 100) / 100;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function evidenceFrom(
  metrics: DerivedMetrics,
  profit: ProfitMetrics | null,
  window: RuleContext["window"],
  notes: string[] = [],
): Evidence {
  return {
    windowStart: window.start,
    windowEnd: window.end,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    cost: metrics.cost,
    conversions: metrics.conversions,
    conversionValue: metrics.conversionValue,
    roas: metrics.roas,
    cpa: metrics.cpa,
    ctr: metrics.ctr,
    conversionRate: metrics.conversionRate,
    profit: profit?.netProfit ?? null,
    notes,
  };
}

function dedupe(parts: (string | number)[]): string {
  return stableHash(parts.join("|"));
}

/**
 * The account's effective ROAS target: explicit setting first, otherwise the account's
 * own trailing performance. Comparing a keyword to a target that does not exist is how
 * naive optimizers destroy accounts.
 */
function effectiveTargets(context: RuleContext): { roas: number | null; cpa: number | null } {
  const { settings, accountMetrics } = context;
  return {
    roas: settings.targetRoas ?? accountMetrics.roas,
    cpa: settings.targetCpa ?? accountMetrics.cpa,
  };
}

// ---------------------------------------------------------------------------
// Budget rules
// ---------------------------------------------------------------------------

export function budgetRules(context: RuleContext): Candidate[] {
  const candidates: Candidate[] = [];
  const targets = effectiveTargets(context);
  const { settings, window, currency } = context;

  for (const campaign of context.campaigns) {
    if (campaign.status !== "ENABLED" || !campaign.budgetId || campaign.budget <= 0) continue;

    const sufficiency = assessDataSufficiency(
      {
        impressions: campaign.metrics.impressions,
        clicks: campaign.metrics.clicks,
        costMicros: campaign.metrics.cost * 1_000_000,
        conversions: campaign.metrics.conversions,
        conversionValueMicros: campaign.metrics.conversionValue * 1_000_000,
      },
      {
        minClicks: settings.minClicksForDecision,
        minImpressions: settings.minImpressionsForDecision,
        minSpend: settings.minSpendForDecision,
      },
    );

    const spendShare = safeDivide(campaign.metrics.cost, context.accountMetrics.cost) ?? 0;

    // --- scale a budget-limited winner ------------------------------------
    const beatsRoasTarget =
      targets.roas !== null && campaign.metrics.roas !== null && campaign.metrics.roas >= targets.roas;
    const beatsCpaTarget =
      targets.cpa !== null && campaign.metrics.cpa !== null && campaign.metrics.cpa <= targets.cpa;
    const profitable = campaign.profit.netProfit > 0;

    if (
      sufficiency.sufficient &&
      campaign.isBudgetLimited &&
      campaign.metrics.conversions >= settings.minConversionsForScaling &&
      (beatsRoasTarget || beatsCpaTarget) &&
      profitable
    ) {
      const clampResult = clampBudget(
        campaign.budget,
        campaign.budget * (1 + settings.maxDailyBudgetIncreasePct / 100),
        settings,
      );

      if (clampResult.value > campaign.budget + 0.01) {
        const extraDailySpend = clampResult.value - campaign.budget;
        const extraMonthlyValue = extraDailySpend * DAYS_PER_MONTH * (campaign.metrics.roas ?? 0);
        const lostShare = campaign.budgetLostImpressionShare ?? 0;

        candidates.push({
          type: "INCREASE_BUDGET",
          targetType: "CAMPAIGN",
          targetId: campaign.campaignId,
          targetName: campaign.name,
          payload: {
            action: "increase_budget",
            campaignId: campaign.campaignId,
            budgetId: campaign.budgetId,
            currentBudget: campaign.budget,
            recommendedBudget: clampResult.value,
          },
          evidence: evidenceFrom(campaign.metrics, campaign.profit, window, [
            `Budget-limited: losing ${(lostShare * 100).toFixed(0)}% of impression share to budget.`,
            `Average daily spend ${money(campaign.averageDailySpend, currency)} against a ${money(campaign.budget, currency)} budget.`,
          ]),
          title: `Increase budget for ${campaign.name}`,
          reason: `${campaign.name} returns ${campaign.metrics.roas?.toFixed(2)}x on ${money(
            campaign.metrics.cost,
            currency,
          )} spend and is capped by its budget — it lost ${(lostShare * 100).toFixed(
            0,
          )}% of available impression share to budget over the last ${window.days} days.`,
          expectedImpact: `About ${money(extraMonthlyValue, currency)} additional conversion value per month if performance holds at the current ${campaign.metrics.roas?.toFixed(2)}x.`,
          confidence: scoreConfidence({
            dataStrength: sufficiency.strength,
            effectSize: relativeGap(campaign.metrics.roas, targets.roas),
            consistency: campaign.metrics.conversions >= 10 ? 0.9 : 0.6,
          }),
          risk: scoreRisk({
            action: "increase_budget",
            monthlyExposure: extraDailySpend * DAYS_PER_MONTH,
            spendShare,
            dataStrength: sufficiency.strength,
            reversible: true,
          }),
          priority: 90,
          estimatedMonthlyImpact: Math.round(extraMonthlyValue),
          dedupeKey: dedupe(["increase_budget", campaign.campaignId, window.end.slice(0, 7)]),
        });
      }
    }

    // --- pull back a losing campaign --------------------------------------
    const missesRoasTarget =
      targets.roas !== null &&
      campaign.metrics.roas !== null &&
      campaign.metrics.roas < targets.roas * 0.6;
    const losingMoney = campaign.profit.netProfit < 0;

    if (
      sufficiency.sufficient &&
      campaign.metrics.cost >= settings.minSpendForDecision * 2 &&
      (missesRoasTarget || losingMoney) &&
      campaign.metrics.conversions >= 1
    ) {
      const clampResult = clampBudget(
        campaign.budget,
        campaign.budget * (1 - settings.maxDailyBudgetDecreasePct / 100),
        settings,
      );

      if (clampResult.value < campaign.budget - 0.01) {
        const savedMonthly = (campaign.budget - clampResult.value) * DAYS_PER_MONTH;

        candidates.push({
          type: "DECREASE_BUDGET",
          targetType: "CAMPAIGN",
          targetId: campaign.campaignId,
          targetName: campaign.name,
          payload: {
            action: "decrease_budget",
            campaignId: campaign.campaignId,
            budgetId: campaign.budgetId,
            currentBudget: campaign.budget,
            recommendedBudget: clampResult.value,
          },
          evidence: evidenceFrom(campaign.metrics, campaign.profit, window, [
            targets.roas !== null
              ? `ROAS ${campaign.metrics.roas?.toFixed(2)}x against a ${targets.roas.toFixed(2)}x target.`
              : "No ROAS target set; judged on profit.",
            `Estimated profit ${money(campaign.profit.netProfit, currency)} over the window.`,
          ]),
          title: `Reduce budget for ${campaign.name}`,
          reason: `${campaign.name} spent ${money(campaign.metrics.cost, currency)} over ${
            window.days
          } days at ${campaign.metrics.roas?.toFixed(2)}x${
            targets.roas ? ` against your ${targets.roas.toFixed(2)}x target` : ""
          }, producing an estimated ${money(campaign.profit.netProfit, currency)} in profit.`,
          expectedImpact: `Frees roughly ${money(savedMonthly, currency)} per month to redeploy into campaigns that clear your target.`,
          confidence: scoreConfidence({
            dataStrength: sufficiency.strength,
            effectSize: relativeGap(campaign.metrics.roas, targets.roas),
            consistency: campaign.metrics.conversions >= 5 ? 0.8 : 0.5,
          }),
          risk: scoreRisk({
            action: "decrease_budget",
            monthlyExposure: savedMonthly,
            spendShare,
            dataStrength: sufficiency.strength,
            reversible: true,
          }),
          priority: 70,
          estimatedMonthlyImpact: Math.round(savedMonthly),
          dedupeKey: dedupe(["decrease_budget", campaign.campaignId, window.end.slice(0, 7)]),
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Keyword rules
// ---------------------------------------------------------------------------

export function keywordRules(context: RuleContext): Candidate[] {
  const candidates: Candidate[] = [];
  const targets = effectiveTargets(context);
  const { settings, window, currency } = context;

  for (const keyword of context.keywords) {
    if (keyword.status !== "ENABLED") continue;

    const sufficiency = assessDataSufficiency(
      {
        impressions: keyword.metrics.impressions,
        clicks: keyword.metrics.clicks,
        costMicros: keyword.metrics.cost * 1_000_000,
        conversions: keyword.metrics.conversions,
        conversionValueMicros: keyword.metrics.conversionValue * 1_000_000,
      },
      {
        minClicks: settings.minClicksForDecision,
        minImpressions: settings.minImpressionsForDecision,
        minSpend: settings.minSpendForDecision,
      },
    );

    const spendShare = safeDivide(keyword.metrics.cost, context.accountMetrics.cost) ?? 0;
    const monthlySpend = monthlyFrom(keyword.metrics.cost, window.days);

    // --- spending with nothing to show ------------------------------------
    if (
      keyword.metrics.conversions === 0 &&
      keyword.metrics.cost >= settings.minSpendForDecision &&
      keyword.metrics.clicks >= settings.minClicksForDecision
    ) {
      candidates.push({
        type: "PAUSE_KEYWORD",
        targetType: "KEYWORD",
        targetId: keyword.criterionId,
        targetName: keyword.name,
        payload: {
          action: "pause_keyword",
          adGroupId: keyword.adGroupId,
          criterionId: keyword.criterionId,
          keywordText: keyword.name,
        },
        evidence: evidenceFrom(keyword.metrics, keyword.profit, window, [
          `${keyword.metrics.clicks} clicks without a single conversion.`,
          `Quality score ${keyword.qualityScore ?? "unavailable"}.`,
        ]),
        title: `Pause "${keyword.name}"`,
        reason: `Spent ${money(keyword.metrics.cost, currency)} over the last ${
          window.days
        } days across ${keyword.metrics.clicks} clicks and generated 0 conversions.`,
        expectedImpact: `Saves about ${money(monthlySpend, currency)} per month with no expected loss in conversions.`,
        confidence: scoreConfidence({
          dataStrength: sufficiency.strength,
          effectSize: 1,
          consistency: keyword.metrics.clicks >= settings.minClicksForDecision * 2 ? 0.9 : 0.6,
        }),
        risk: scoreRisk({
          action: "pause_keyword",
          monthlyExposure: monthlySpend,
          spendShare,
          dataStrength: sufficiency.strength,
          reversible: true,
        }),
        priority: 85,
        estimatedMonthlyImpact: Math.round(monthlySpend),
        dedupeKey: dedupe(["pause_keyword", keyword.criterionId, window.end.slice(0, 7)]),
      });
      continue;
    }

    if (!sufficiency.sufficient) continue;
    const currentBid = keyword.cpcBid ?? keyword.metrics.cpc ?? 0;
    if (currentBid <= 0) continue;

    // --- CPA drifting above target ----------------------------------------
    if (
      targets.cpa !== null &&
      keyword.metrics.cpa !== null &&
      keyword.metrics.cpa > targets.cpa * 1.3 &&
      keyword.metrics.conversions >= 1
    ) {
      const ratio = targets.cpa / keyword.metrics.cpa;
      const clampResult = clampBid(currentBid, currentBid * ratio, settings);

      if (clampResult.value < currentBid - 0.01) {
        const monthlySaving = monthlySpend * (1 - clampResult.value / currentBid);
        candidates.push({
          type: "DECREASE_KEYWORD_BID",
          targetType: "KEYWORD",
          targetId: keyword.criterionId,
          targetName: keyword.name,
          payload: {
            action: "decrease_keyword_bid",
            adGroupId: keyword.adGroupId,
            criterionId: keyword.criterionId,
            keywordText: keyword.name,
            currentBid,
            recommendedBid: clampResult.value,
          },
          evidence: evidenceFrom(keyword.metrics, keyword.profit, window, [
            `CPA ${money(keyword.metrics.cpa, currency)} against a ${money(targets.cpa, currency)} target.`,
          ]),
          title: `Lower the bid on "${keyword.name}"`,
          reason: `CPA is ${money(keyword.metrics.cpa, currency)}, ${(
            (keyword.metrics.cpa / targets.cpa - 1) *
            100
          ).toFixed(0)}% above your ${money(targets.cpa, currency)} target, across ${
            keyword.metrics.conversions
          } conversions.`,
          expectedImpact: `Reducing the bid from ${money(currentBid, currency)} to ${money(
            clampResult.value,
            currency,
          )} should pull CPA toward target and save roughly ${money(monthlySaving, currency)} per month.`,
          confidence: scoreConfidence({
            dataStrength: sufficiency.strength,
            effectSize: relativeGap(keyword.metrics.cpa, targets.cpa),
            consistency: keyword.metrics.conversions >= 5 ? 0.85 : 0.55,
          }),
          risk: scoreRisk({
            action: "decrease_keyword_bid",
            monthlyExposure: monthlySaving,
            spendShare,
            dataStrength: sufficiency.strength,
            reversible: true,
          }),
          priority: 65,
          estimatedMonthlyImpact: Math.round(monthlySaving),
          dedupeKey: dedupe(["decrease_bid", keyword.criterionId, window.end.slice(0, 7)]),
        });
        continue;
      }
    }

    // --- a proven winner worth more traffic -------------------------------
    const clearsRoas =
      targets.roas !== null && keyword.metrics.roas !== null && keyword.metrics.roas >= targets.roas * 1.25;
    const clearsCpa =
      targets.cpa !== null && keyword.metrics.cpa !== null && keyword.metrics.cpa <= targets.cpa * 0.7;

    if (
      (clearsRoas || clearsCpa) &&
      keyword.metrics.conversions >= settings.minConversionsForScaling &&
      keyword.profit.netProfit > 0
    ) {
      const clampResult = clampBid(currentBid, currentBid * 1.15, settings);

      if (clampResult.value > currentBid + 0.01) {
        const upliftMonthly = monthlySpend * 0.15 * (keyword.metrics.roas ?? 1);
        candidates.push({
          type: "INCREASE_KEYWORD_BID",
          targetType: "KEYWORD",
          targetId: keyword.criterionId,
          targetName: keyword.name,
          payload: {
            action: "increase_keyword_bid",
            adGroupId: keyword.adGroupId,
            criterionId: keyword.criterionId,
            keywordText: keyword.name,
            currentBid,
            recommendedBid: clampResult.value,
          },
          evidence: evidenceFrom(keyword.metrics, keyword.profit, window, [
            keyword.metrics.roas !== null ? `ROAS ${keyword.metrics.roas.toFixed(2)}x.` : "",
            `Estimated profit ${money(keyword.profit.netProfit, currency)} in the window.`,
          ].filter(Boolean)),
          title: `Raise the bid on "${keyword.name}"`,
          reason: `This keyword returns ${keyword.metrics.roas?.toFixed(2)}x on ${money(
            keyword.metrics.cost,
            currency,
          )} across ${keyword.metrics.conversions} conversions — comfortably above target — so there is room to buy more of this traffic.`,
          expectedImpact: `A 15% bid increase typically buys proportionally more impressions; at the current return that is roughly ${money(
            upliftMonthly,
            currency,
          )} additional monthly conversion value.`,
          confidence: scoreConfidence({
            dataStrength: sufficiency.strength,
            effectSize: relativeGap(keyword.metrics.roas, targets.roas),
            consistency: keyword.metrics.conversions >= 8 ? 0.85 : 0.6,
          }),
          risk: scoreRisk({
            action: "increase_keyword_bid",
            monthlyExposure: monthlySpend * 0.15,
            spendShare,
            dataStrength: sufficiency.strength,
            reversible: true,
          }),
          priority: 75,
          estimatedMonthlyImpact: Math.round(upliftMonthly),
          dedupeKey: dedupe(["increase_bid", keyword.criterionId, window.end.slice(0, 7)]),
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Search term rules
// ---------------------------------------------------------------------------

export function searchTermRules(context: RuleContext): Candidate[] {
  const candidates: Candidate[] = [];
  const { settings, window, currency } = context;
  const targets = effectiveTargets(context);
  const wasteThreshold = Math.max(settings.minSpendForDecision * 0.4, targets.cpa ?? 0);

  for (const term of context.searchTerms) {
    const normalized = term.text.trim().toLowerCase();
    if (context.existingNegatives.has(normalized)) continue;

    const assessment = classifySearchTerm({
      text: term.text,
      clicks: term.metrics.clicks,
      cost: term.metrics.cost,
      conversions: term.metrics.conversions,
      conversionValue: term.metrics.conversionValue,
    });

    const monthlySpend = monthlyFrom(term.metrics.cost, window.days);

    // --- money going nowhere ----------------------------------------------
    const isWaste =
      term.metrics.conversions === 0 &&
      term.metrics.cost >= wasteThreshold &&
      term.metrics.clicks >= Math.max(3, Math.round(settings.minClicksForDecision * 0.3));

    if (isWaste && (assessment.intent === "IRRELEVANT" || assessment.intent === "LOW_INTENT")) {
      // Prefer the narrowest scope we can safely target: an ad group negative only blocks
      // the term where it actually wasted money, a campaign negative blocks it everywhere.
      const level = term.googleAdGroupId ? "AD_GROUP" : "CAMPAIGN";
      if (level === "CAMPAIGN" && !term.googleCampaignId) continue;

      candidates.push({
        type: "ADD_NEGATIVE_KEYWORD",
        targetType: "SEARCH_TERM",
        targetId: normalized,
        targetName: term.text,
        payload: {
          action: "add_negative_keyword",
          level,
          campaignId: term.googleCampaignId,
          adGroupId: term.googleAdGroupId,
          text: term.text,
          matchType: "PHRASE",
        },
        evidence: evidenceFrom(term.metrics, term.profit, window, [
          assessment.reason ?? "No conversions recorded.",
          `Triggered by ${term.triggeredKeyword ?? "an unknown keyword"}.`,
        ]),
        title: `Exclude "${term.text}"`,
        reason: `Spent ${money(term.metrics.cost, currency)} across ${
          term.metrics.clicks
        } clicks without a conversion. ${assessment.reason ?? ""}`.trim(),
        expectedImpact: `Blocks roughly ${money(monthlySpend, currency)} of monthly spend on traffic that has not converted.`,
        confidence: scoreConfidence({
          dataStrength: Math.min(1, term.metrics.clicks / Math.max(5, settings.minClicksForDecision * 0.5)),
          effectSize: assessment.intent === "IRRELEVANT" ? 1 : 0.7,
          consistency: 0.8,
        }),
        risk: scoreRisk({
          action: "add_negative_keyword",
          monthlyExposure: monthlySpend,
          spendShare: safeDivide(term.metrics.cost, context.accountMetrics.cost) ?? 0,
          dataStrength: Math.min(1, term.metrics.clicks / 10),
          reversible: true,
        }),
        priority: assessment.intent === "IRRELEVANT" ? 88 : 72,
        estimatedMonthlyImpact: Math.round(monthlySpend),
        dedupeKey: dedupe(["negative", normalized, window.end.slice(0, 7)]),
      });
      continue;
    }

    // --- a converting term that is not yet a keyword ----------------------
    const isWinner =
      term.metrics.conversions >= Math.max(2, settings.minConversionsForScaling * 0.6) &&
      term.status !== "ADDED" &&
      !context.existingKeywords.has(normalized) &&
      term.googleAdGroupId !== null;

    if (isWinner) {
      const adGroupId = term.googleAdGroupId;
      if (!adGroupId) continue;

      candidates.push({
        type: "ADD_KEYWORD",
        targetType: "SEARCH_TERM",
        targetId: normalized,
        targetName: term.text,
        payload: {
          action: "add_keyword",
          adGroupId,
          text: term.text,
          matchType: "EXACT",
          cpcBid: null,
        },
        evidence: evidenceFrom(term.metrics, term.profit, window, [
          `${term.metrics.conversions} conversions at ${money(term.metrics.cpa ?? 0, currency)} CPA.`,
          `Currently matched through ${term.triggeredKeyword ?? "a broader keyword"}.`,
        ]),
        title: `Add "${term.text}" as an exact keyword`,
        reason: `This search term produced ${term.metrics.conversions} conversions worth ${money(
          term.metrics.conversionValue,
          currency,
        )} while matching through a broader keyword. Adding it as exact gives it its own bid and ad copy.`,
        expectedImpact: `Tighter control over a term already worth ${money(
          monthlyFrom(term.metrics.conversionValue, window.days),
          currency,
        )} per month.`,
        confidence: scoreConfidence({
          dataStrength: Math.min(1, term.metrics.conversions / 4),
          effectSize: 0.6,
          consistency: 0.75,
        }),
        risk: "LOW",
        priority: 68,
        estimatedMonthlyImpact: Math.round(monthlyFrom(term.metrics.conversionValue, window.days) * 0.1),
        dedupeKey: dedupe(["add_keyword", normalized, window.end.slice(0, 7)]),
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Ad rules
// ---------------------------------------------------------------------------

export function adRules(context: RuleContext): Candidate[] {
  const candidates: Candidate[] = [];
  const { settings, window, currency } = context;

  const byAdGroup = new Map<string, AdPerformance[]>();
  for (const ad of context.ads) {
    const list = byAdGroup.get(ad.adGroupRowId) ?? [];
    list.push(ad);
    byAdGroup.set(ad.adGroupRowId, list);
  }

  for (const [, ads] of byAdGroup) {
    const eligible = ads.filter(
      (ad) => ad.status === "ENABLED" && ad.metrics.impressions >= settings.minImpressionsForDecision,
    );
    if (eligible.length < 2) continue;

    const ranked = [...eligible].sort(
      (a, b) => (b.metrics.conversionRate ?? 0) - (a.metrics.conversionRate ?? 0),
    );
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best.id === worst.id) continue;

    const bestRate = best.metrics.conversionRate ?? 0;
    const worstRate = worst.metrics.conversionRate ?? 0;
    const worseByHalf = bestRate > 0 && worstRate < bestRate * 0.5;
    const enoughClicks = worst.metrics.clicks >= settings.minClicksForDecision;

    if (worseByHalf && enoughClicks) {
      const monthlySpend = monthlyFrom(worst.metrics.cost, window.days);
      candidates.push({
        type: "PAUSE_AD",
        targetType: "AD",
        targetId: worst.adId,
        targetName: worst.name,
        payload: { action: "pause_ad", adGroupId: worst.googleAdGroupId, adId: worst.adId },
        evidence: evidenceFrom(worst.metrics, worst.profit, window, [
          `Conversion rate ${(worstRate * 100).toFixed(2)}% against ${(bestRate * 100).toFixed(
            2,
          )}% for the best ad in the same ad group.`,
        ]),
        title: `Pause the weakest ad in ${worst.adGroupName}`,
        reason: `"${worst.name}" converts at ${(worstRate * 100).toFixed(2)}% while "${
          best.name
        }" in the same ad group converts at ${(bestRate * 100).toFixed(
          2,
        )}%, over ${worst.metrics.clicks} clicks.`,
        expectedImpact: `Redirects roughly ${money(monthlySpend, currency)} of monthly spend to the ad that converts twice as well.`,
        confidence: scoreConfidence({
          dataStrength: Math.min(1, worst.metrics.clicks / (settings.minClicksForDecision * 2)),
          effectSize: 0.8,
          consistency: 0.7,
        }),
        risk: "LOW",
        priority: 60,
        estimatedMonthlyImpact: Math.round(monthlySpend * 0.2),
        dedupeKey: dedupe(["pause_ad", worst.adId, window.end.slice(0, 7)]),
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Tracking health
// ---------------------------------------------------------------------------

export function trackingRules(context: RuleContext): Candidate[] {
  const { accountMetrics, settings, window, currency } = context;

  if (
    accountMetrics.cost >= settings.minSpendForDecision * 3 &&
    accountMetrics.conversions === 0
  ) {
    return [
      {
        type: "REVIEW_CONVERSION_TRACKING",
        targetType: "ACCOUNT",
        targetId: "account",
        targetName: "Conversion tracking",
        payload: {
          action: "review_conversion_tracking",
          detail: "No conversions recorded while the account is spending.",
        },
        evidence: evidenceFrom(accountMetrics, context.accountProfit, window, [
          "Zero conversions recorded across the whole window.",
        ]),
        title: "Check conversion tracking",
        reason: `The account spent ${money(accountMetrics.cost, currency)} over ${
          window.days
        } days and recorded no conversions at all. That pattern is far more often a broken tag than a market change, so no optimization decisions should be made until it is confirmed.`,
        expectedImpact:
          "Restores the signal every other recommendation depends on. Until then, optimization is paused.",
        confidence: 0.9,
        risk: "LOW",
        priority: 100,
        estimatedMonthlyImpact: 0,
        dedupeKey: dedupe(["tracking", window.end.slice(0, 7)]),
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------

export function generateCandidates(context: RuleContext): Candidate[] {
  const tracking = trackingRules(context);
  // A broken conversion signal invalidates every performance-based decision.
  if (tracking.length > 0) return tracking;

  return [
    ...budgetRules(context),
    ...keywordRules(context),
    ...searchTermRules(context),
    ...adRules(context),
  ].sort((a, b) => b.priority - a.priority || b.estimatedMonthlyImpact - a.estimatedMonthlyImpact);
}
