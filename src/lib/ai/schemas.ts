import { z } from "zod";

/**
 * The contract between the LLM and the rest of the system.
 *
 * Two rules shape everything here:
 *   1. The model never produces numbers that drive a mutation. Budgets, bids and
 *      thresholds are computed by the rule engine; the model contributes language,
 *      classification and prioritization.
 *   2. Every response is parsed with a strict schema before it is used. Unknown keys
 *      are rejected rather than ignored, so a drifting model fails loudly.
 */

export const confidenceSchema = z
  .number()
  .min(0)
  .max(1)
  .describe("How confident the analysis is, 0 to 1.");

export const riskSchema = z.enum(["low", "medium", "high"]);

// ---------------------------------------------------------------------------
// Search term classification
// ---------------------------------------------------------------------------

export const searchTermIntentSchema = z.enum([
  "high_intent",
  "medium_intent",
  "low_intent",
  "irrelevant",
]);

export const searchTermActionSchema = z.enum([
  "add_keyword",
  "add_negative_keyword",
  "monitor",
  "ignore",
]);

export const searchTermClassificationSchema = z
  .object({
    text: z.string().min(1),
    intent: searchTermIntentSchema,
    recommendedAction: searchTermActionSchema,
    reason: z.string().min(5).max(400),
    confidence: confidenceSchema,
  })
  .strict();

export const searchTermClassificationResponseSchema = z
  .object({
    classifications: z.array(searchTermClassificationSchema).max(200),
  })
  .strict();

export type SearchTermClassification = z.infer<typeof searchTermClassificationSchema>;

// ---------------------------------------------------------------------------
// Recommendation narrative (the model explains a deterministic candidate)
// ---------------------------------------------------------------------------

export const recommendationNarrativeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(5).max(90),
    reason: z.string().min(20).max(600),
    expectedImpact: z.string().min(5).max(300),
    priority: z.number().int().min(1).max(100),
    confidence: confidenceSchema,
    risk: riskSchema,
  })
  .strict();

export const recommendationNarrativeResponseSchema = z
  .object({
    recommendations: z.array(recommendationNarrativeSchema).max(60),
  })
  .strict();

export type RecommendationNarrative = z.infer<typeof recommendationNarrativeSchema>;

// ---------------------------------------------------------------------------
// Account summary
// ---------------------------------------------------------------------------

export const accountSummarySchema = z
  .object({
    headline: z.string().min(10).max(200),
    summary: z.string().min(40).max(900),
    biggestOpportunity: z.string().min(10).max(400),
    biggestWaste: z.string().min(10).max(400),
    watchOut: z.string().max(400).nullable(),
    /** Empty when the account has too little data to say anything useful. */
    insights: z.array(z.string().min(5).max(240)).max(5),
  })
  .strict();

export type AccountSummary = z.infer<typeof accountSummarySchema>;

// ---------------------------------------------------------------------------
// Ad copy generation
// ---------------------------------------------------------------------------

export const adCopySchema = z
  .object({
    headlines: z.array(z.string().min(3).max(30)).min(5).max(15),
    descriptions: z.array(z.string().min(10).max(90)).min(2).max(4),
    rationale: z.string().min(20).max(600),
  })
  .strict();

export type AdCopy = z.infer<typeof adCopySchema>;

// ---------------------------------------------------------------------------
// Executable action payloads
// ---------------------------------------------------------------------------

/**
 * The payload persisted on a recommendation and read by the executor. Values are
 * produced by the rule engine, validated here, and re-validated against the account's
 * safety limits immediately before execution.
 */
export const actionPayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("increase_budget"),
      campaignId: z.string().min(1),
      budgetId: z.string().min(1),
      currentBudget: z.number().nonnegative(),
      recommendedBudget: z.number().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("decrease_budget"),
      campaignId: z.string().min(1),
      budgetId: z.string().min(1),
      currentBudget: z.number().nonnegative(),
      recommendedBudget: z.number().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pause_keyword"),
      adGroupId: z.string().min(1),
      criterionId: z.string().min(1),
      keywordText: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("enable_keyword"),
      adGroupId: z.string().min(1),
      criterionId: z.string().min(1),
      keywordText: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("increase_keyword_bid"),
      adGroupId: z.string().min(1),
      criterionId: z.string().min(1),
      keywordText: z.string().min(1),
      currentBid: z.number().nonnegative(),
      recommendedBid: z.number().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("decrease_keyword_bid"),
      adGroupId: z.string().min(1),
      criterionId: z.string().min(1),
      keywordText: z.string().min(1),
      currentBid: z.number().nonnegative(),
      recommendedBid: z.number().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_negative_keyword"),
      level: z.enum(["CAMPAIGN", "AD_GROUP"]),
      campaignId: z.string().min(1).nullable(),
      adGroupId: z.string().min(1).nullable(),
      text: z.string().min(1).max(80),
      matchType: z.enum(["EXACT", "PHRASE", "BROAD"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_keyword"),
      adGroupId: z.string().min(1),
      text: z.string().min(1).max(80),
      matchType: z.enum(["EXACT", "PHRASE", "BROAD"]),
      cpcBid: z.number().positive().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pause_ad"),
      adGroupId: z.string().min(1),
      adId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_ad_variant"),
      adGroupId: z.string().min(1),
      sourceAdId: z.string().nullable(),
      headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
      descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
      finalUrl: z.string().url(),
      path1: z.string().max(15).nullable().default(null),
      path2: z.string().max(15).nullable().default(null),
    })
    .strict(),
  z
    .object({
      action: z.literal("pause_campaign"),
      campaignId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("review_conversion_tracking"),
      detail: z.string().min(5).max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("monitor"),
      detail: z.string().min(5).max(300),
    })
    .strict(),
]);

export type ActionPayload = z.infer<typeof actionPayloadSchema>;
export type ActionName = ActionPayload["action"];

/** Supporting metrics attached to every recommendation. Never model-generated. */
export const evidenceSchema = z
  .object({
    windowStart: z.string(),
    windowEnd: z.string(),
    impressions: z.number().nonnegative(),
    clicks: z.number().nonnegative(),
    cost: z.number().nonnegative(),
    conversions: z.number().nonnegative(),
    conversionValue: z.number().nonnegative(),
    roas: z.number().nullable(),
    cpa: z.number().nullable(),
    ctr: z.number().nullable(),
    conversionRate: z.number().nullable(),
    profit: z.number().nullable(),
    notes: z.array(z.string()).max(10).default([]),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;

// ---------------------------------------------------------------------------
// Chat tool calls
// ---------------------------------------------------------------------------

export const chatToolNameSchema = z.enum([
  "getAccountOverview",
  "getCampaignPerformance",
  "getKeywordPerformance",
  "getSearchTerms",
  "getAdPerformance",
  "getBudgetPerformance",
  "getConversionPerformance",
  "getSegmentPerformance",
  "getRecommendations",
  "getAnomalies",
]);

export type ChatToolName = z.infer<typeof chatToolNameSchema>;

/** Arguments a model may pass to a read tool. Deliberately narrow. */
export const chatToolArgumentsSchema = z
  .object({
    days: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    sortBy: z.enum(["cost", "conversions", "conversionValue", "roas", "cpa", "clicks"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    onlyUnconverted: z.boolean().optional(),
    segment: z.enum(["DEVICE", "LOCATION", "HOUR_OF_DAY", "DAY_OF_WEEK", "NETWORK"]).optional(),
    campaignName: z.string().max(120).optional(),
  })
  .strict();

export type ChatToolArguments = z.infer<typeof chatToolArgumentsSchema>;
