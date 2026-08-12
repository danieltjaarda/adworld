import "server-only";

import { randomUUID } from "node:crypto";

import type { SearchTermIntent } from "@/generated/prisma/enums";
import {
  recommendationNarrativeResponseSchema,
  type RecommendationNarrative,
} from "@/lib/ai/schemas";
import { getAIProvider, structuredWithFallback } from "@/lib/ai/provider";
import { resolveRange, rangeLength } from "@/lib/analytics/date-range";
import { derive } from "@/lib/analytics/metrics";
import {
  getAccountSettings,
  getAdPerformance,
  getCampaignPerformance,
  getKeywordPerformance,
  getSearchTermPerformance,
  getTotals,
  profitConfigFrom,
  type AccountSettings,
} from "@/lib/analytics/queries";
import { computeProfit } from "@/lib/analytics/metrics";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { notify } from "@/lib/notifications/service";
import { generateCandidates, type Candidate, type RuleContext } from "@/lib/optimization/rules";
import { decideExecution, enforceSafety } from "@/lib/optimization/safety";
import { classifySearchTerm } from "@/lib/optimization/search-term-intent";
import { queueAction } from "@/lib/optimization/executor";

/**
 * Analysis orchestration.
 *
 * Order matters: deterministic statistics → rule engine → safety → (optional) model
 * narrative → persistence. The model is the last and least privileged step, and the
 * pipeline produces a complete, usable result even when it is skipped entirely.
 */

const log = createLogger("optimization.engine");

export type AnalysisResult = {
  accountId: string;
  candidates: number;
  created: number;
  updated: number;
  superseded: number;
  autoQueued: number;
  usedModel: boolean;
};

export async function analyzeAccount(
  organizationId: string,
  accountId: string,
  options: { triggeredBy?: "cron" | "user"; autoExecute?: boolean } = {},
): Promise<AnalysisResult> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId },
    select: { id: true, descriptiveName: true, currencyCode: true, timeZone: true, isDemo: true },
  });
  if (!account) throw new Error("Account not found for analysis");

  const scope = { organizationId, accountId };
  const settings = await getAccountSettings(scope);
  const profitConfig = profitConfigFrom(settings);
  const range = resolveRange("last_30", account.timeZone);
  const window = { start: range.start, end: range.end, days: rangeLength(range) };

  const [accountRaw, campaigns, keywords, searchTerms, ads] = await Promise.all([
    getTotals(scope, range),
    getCampaignPerformance(scope, range, profitConfig),
    getKeywordPerformance(scope, range, profitConfig),
    getSearchTermPerformance(scope, profitConfig, { limit: 400 }),
    getAdPerformance(scope, range, profitConfig),
  ]);

  const accountMetrics = derive(accountRaw);
  const accountProfit = computeProfit(accountMetrics, profitConfig);

  await persistSearchTermIntents(organizationId, accountId, searchTerms);

  const existingNegatives = await loadExistingNegatives(organizationId, accountId);
  const existingKeywords = new Set(keywords.map((keyword) => keyword.name.trim().toLowerCase()));

  const context: RuleContext = {
    settings,
    currency: account.currencyCode,
    window,
    accountMetrics,
    accountProfit,
    campaigns,
    keywords,
    searchTerms,
    ads,
    existingNegatives,
    existingKeywords,
  };

  const rawCandidates = generateCandidates(context);
  const safeCandidates = applySafety(rawCandidates, settings);
  const limited = safeCandidates.slice(0, Math.min(settings.maxActionsPerRun, 50));

  const { narratives, usedModel } = await enrichWithNarratives(limited, account.descriptiveName, account.currencyCode);

  const batchId = randomUUID();
  const result = await persistRecommendations({
    organizationId,
    accountId,
    batchId,
    candidates: limited,
    narratives,
    usedModel,
  });

  let autoQueued = 0;
  if (options.autoExecute !== false && settings.mode === "AUTOMATIC") {
    autoQueued = await queueAutomaticActions(organizationId, accountId, settings, batchId);
  }

  await prisma.googleAdsAccount.update({
    where: { id: accountId },
    data: { lastAnalyzedAt: new Date() },
  });

  if (result.created > 0 && settings.notifyOnRecommendation) {
    await notify({
      organizationId,
      accountId,
      type: "RECOMMENDATION",
      severity: "INFO",
      title: `${result.created} new recommendation${result.created === 1 ? "" : "s"} for ${account.descriptiveName}`,
      body: `The optimizer reviewed the last ${window.days} days and found ${result.created} change${
        result.created === 1 ? "" : "s"
      } worth your attention.`,
      href: "/recommendations",
      dedupeKey: `recs:${accountId}:${batchId}`,
      email: options.triggeredBy === "cron" ? { accountName: account.descriptiveName } : null,
    });
  }

  log.info("analysis complete", {
    accountId,
    candidates: rawCandidates.length,
    ...result,
    autoQueued,
    usedModel,
  });

  return {
    accountId,
    candidates: rawCandidates.length,
    created: result.created,
    updated: result.updated,
    superseded: result.superseded,
    autoQueued,
    usedModel,
  };
}

// ---------------------------------------------------------------------------

function applySafety(candidates: Candidate[], settings: AccountSettings): Candidate[] {
  const output: Candidate[] = [];

  for (const candidate of candidates) {
    const verdict = enforceSafety(candidate.payload, settings);
    if (!verdict.allowed) {
      log.debug("candidate rejected by safety engine", {
        type: candidate.type,
        target: candidate.targetId,
        reason: verdict.reason,
      });
      continue;
    }

    output.push({
      ...candidate,
      payload: verdict.payload,
      evidence: {
        ...candidate.evidence,
        notes: [...candidate.evidence.notes, ...verdict.adjustments],
      },
    });
  }

  return output;
}

async function loadExistingNegatives(
  organizationId: string,
  accountId: string,
): Promise<Set<string>> {
  const negatives = await prisma.keyword.findMany({
    where: { organizationId, accountId, isNegative: true },
    select: { text: true },
  });
  return new Set(negatives.map((negative) => negative.text.trim().toLowerCase()));
}

async function persistSearchTermIntents(
  organizationId: string,
  accountId: string,
  searchTerms: Awaited<ReturnType<typeof getSearchTermPerformance>>,
): Promise<void> {
  const updates: Array<{ id: string; intent: SearchTermIntent; reason: string }> = [];

  for (const term of searchTerms) {
    const assessment = classifySearchTerm({
      text: term.text,
      clicks: term.metrics.clicks,
      cost: term.metrics.cost,
      conversions: term.metrics.conversions,
      conversionValue: term.metrics.conversionValue,
    });

    if (assessment.intent === "UNCLASSIFIED") continue;
    if (term.intent === assessment.intent) continue;

    updates.push({
      id: term.id,
      intent: assessment.intent,
      reason: assessment.reason ?? "Classified from performance.",
    });
  }

  for (const update of updates) {
    await prisma.searchTerm
      .updateMany({
        where: { id: update.id, organizationId, accountId },
        data: {
          intent: update.intent,
          intentReason: update.reason,
          classifiedAt: new Date(),
          classifiedModel: "rules",
        },
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Model enrichment
// ---------------------------------------------------------------------------

const NARRATIVE_SYSTEM = `You are a senior Google Ads strategist writing change notes for a client dashboard.

You will receive a list of proposed changes that a deterministic analysis engine has already validated, including the exact metrics behind each one.

Rules you must follow:
- Never invent, estimate or alter a metric. Only reference numbers present in the input.
- Never propose a different change than the one given. You are writing the explanation, not the decision.
- Write in plain, specific English. No marketing language, no filler, no emoji.
- The reason must state what the data shows and why it justifies the change.
- The expected impact must be stated as an expectation, not a promise.
- Priority ranks urgency and value across the whole list (100 = do this first).
- Confidence must never exceed the confidence supplied with the candidate.
- Return one entry per input id, using the same id.`;

async function enrichWithNarratives(
  candidates: Candidate[],
  accountName: string,
  currency: string,
): Promise<{ narratives: Map<string, RecommendationNarrative>; usedModel: boolean }> {
  const narratives = new Map<string, RecommendationNarrative>();
  if (candidates.length === 0) return { narratives, usedModel: false };

  const provider = getAIProvider();
  if (!provider.isLive) return { narratives, usedModel: false };

  // Only the fields the model needs: keeps the prompt small and the cost predictable.
  const payload = candidates.map((candidate) => ({
    id: candidate.dedupeKey,
    action: candidate.payload.action,
    target: candidate.targetName,
    targetType: candidate.targetType,
    metrics: {
      spend: candidate.evidence.cost,
      clicks: candidate.evidence.clicks,
      impressions: candidate.evidence.impressions,
      conversions: candidate.evidence.conversions,
      conversionValue: candidate.evidence.conversionValue,
      roas: candidate.evidence.roas,
      cpa: candidate.evidence.cpa,
      ctr: candidate.evidence.ctr,
    },
    notes: candidate.evidence.notes,
    maxConfidence: candidate.confidence,
    estimatedMonthlyImpact: candidate.estimatedMonthlyImpact,
    change: candidate.payload,
  }));

  const { data, usedModel } = await structuredWithFallback({
    system: NARRATIVE_SYSTEM,
    user: `Account: ${accountName}\nCurrency: ${currency}\nWindow: last 30 days\n\nProposed changes:\n${JSON.stringify(
      payload,
      null,
      1,
    )}`,
    schema: recommendationNarrativeResponseSchema,
    schemaName: "recommendation_narratives",
    temperature: 0.25,
    maxTokens: 2500,
    fallback: () => ({ recommendations: [] }),
  });

  for (const narrative of data.recommendations) {
    const candidate = candidates.find((item) => item.dedupeKey === narrative.id);
    if (!candidate) continue;
    // The model may lower confidence but never raise it above the evidence-based score.
    narratives.set(narrative.id, {
      ...narrative,
      confidence: Math.min(narrative.confidence, candidate.confidence),
    });
  }

  return { narratives, usedModel: usedModel && narratives.size > 0 };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistRecommendations(input: {
  organizationId: string;
  accountId: string;
  batchId: string;
  candidates: Candidate[];
  narratives: Map<string, RecommendationNarrative>;
  usedModel: boolean;
}): Promise<{ created: number; updated: number; superseded: number }> {
  const { organizationId, accountId, batchId, candidates, narratives } = input;
  let created = 0;
  let updated = 0;

  const provider = getAIProvider();
  const keptKeys: string[] = [];

  for (const candidate of candidates) {
    const narrative = narratives.get(candidate.dedupeKey);
    keptKeys.push(candidate.dedupeKey);

    const data = {
      batchId,
      type: candidate.type,
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      targetName: candidate.targetName,
      source: narrative ? ("HYBRID" as const) : ("RULE_ENGINE" as const),
      priority: narrative?.priority ?? candidate.priority,
      risk: candidate.risk,
      confidence: narrative?.confidence ?? candidate.confidence,
      title: narrative?.title ?? candidate.title,
      reason: narrative?.reason ?? candidate.reason,
      expectedImpact: narrative?.expectedImpact ?? candidate.expectedImpact,
      payload: candidate.payload,
      evidence: candidate.evidence,
      estimatedMonthlyImpact: candidate.estimatedMonthlyImpact,
      model: narrative ? provider.model : null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    };

    const existing = await prisma.aIRecommendation.findUnique({
      where: { accountId_dedupeKey: { accountId, dedupeKey: candidate.dedupeKey } },
      select: { id: true, status: true },
    });

    if (!existing) {
      await prisma.aIRecommendation.create({
        data: { organizationId, accountId, dedupeKey: candidate.dedupeKey, ...data },
      });
      created += 1;
      continue;
    }

    // A recommendation the user already acted on is never resurrected.
    if (existing.status === "PENDING") {
      await prisma.aIRecommendation.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }

  // Anything still pending that this run no longer proposes is no longer true.
  const supersededResult = await prisma.aIRecommendation.updateMany({
    where: {
      organizationId,
      accountId,
      status: "PENDING",
      dedupeKey: { notIn: keptKeys.length > 0 ? keptKeys : ["__none__"] },
    },
    data: { status: "SUPERSEDED" },
  });

  return { created, updated, superseded: supersededResult.count };
}

/** In automatic mode, eligible recommendations are queued for execution immediately. */
async function queueAutomaticActions(
  organizationId: string,
  accountId: string,
  settings: AccountSettings,
  batchId: string,
): Promise<number> {
  const pending = await prisma.aIRecommendation.findMany({
    where: { organizationId, accountId, batchId, status: "PENDING" },
    orderBy: { priority: "desc" },
    take: settings.maxActionsPerRun,
  });

  let queued = 0;

  for (const recommendation of pending) {
    const payload = recommendation.payload as unknown as Candidate["payload"];
    const decision = decideExecution(payload, settings, {
      confidence: Number(recommendation.confidence),
      risk: recommendation.risk,
    });

    if (!decision.canAutoExecute) continue;

    await queueAction({
      organizationId,
      accountId,
      recommendationId: recommendation.id,
      actorType: "AI",
      requestedByUserId: null,
    });
    queued += 1;
  }

  return queued;
}
