import { describe, expect, it } from "vitest";

import {
  actionPayloadSchema,
  adCopySchema,
  chatToolArgumentsSchema,
  evidenceSchema,
  recommendationNarrativeResponseSchema,
  searchTermClassificationResponseSchema,
} from "@/lib/ai/schemas";

/**
 * Model output is untrusted input. These tests pin down the boundary: what shape is
 * accepted, and — more importantly — what a drifting or adversarial model cannot slip
 * through.
 */

describe("action payloads", () => {
  it("accepts a well-formed budget change", () => {
    const parsed = actionPayloadSchema.safeParse({
      action: "increase_budget",
      campaignId: "123",
      budgetId: "456",
      currentBudget: 50,
      recommendedBudget: 60,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an action that is not in the union", () => {
    const parsed = actionPayloadSchema.safeParse({
      action: "delete_campaign",
      campaignId: "123",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects extra keys rather than ignoring them", () => {
    const parsed = actionPayloadSchema.safeParse({
      action: "pause_keyword",
      adGroupId: "1",
      criterionId: "2",
      keywordText: "shoes",
      alsoDeleteTheCampaign: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a negative or zero budget", () => {
    expect(
      actionPayloadSchema.safeParse({
        action: "increase_budget",
        campaignId: "1",
        budgetId: "2",
        currentBudget: 50,
        recommendedBudget: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects an ad variant with a non-URL final URL", () => {
    expect(
      actionPayloadSchema.safeParse({
        action: "create_ad_variant",
        adGroupId: "1",
        sourceAdId: null,
        headlines: ["One", "Two", "Three"],
        descriptions: ["A description here", "Another description here"],
        finalUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("enforces Google's length limits on ad copy", () => {
    expect(
      adCopySchema.safeParse({
        headlines: Array.from({ length: 5 }, () => "x".repeat(31)),
        descriptions: ["A valid description", "Another valid description"],
        rationale: "Testing that overlong headlines are rejected before publishing.",
      }).success,
    ).toBe(false);
  });
});

describe("narrative responses", () => {
  it("accepts a valid recommendation narrative", () => {
    const parsed = recommendationNarrativeResponseSchema.safeParse({
      recommendations: [
        {
          id: "rec-1",
          title: "Increase budget on Brand Search",
          reason:
            "The campaign has run out of budget on 24 of the last 30 days while returning 8.4x.",
          expectedImpact: "About 40 more conversions a month at the same efficiency.",
          priority: 90,
          confidence: 0.88,
          risk: "low",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a confidence outside 0–1", () => {
    const parsed = recommendationNarrativeResponseSchema.safeParse({
      recommendations: [
        {
          id: "rec-1",
          title: "Increase budget",
          reason: "A reason long enough to satisfy the schema requirements here.",
          expectedImpact: "More conversions",
          priority: 90,
          confidence: 1.4,
          risk: "low",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a search term classification with an unknown action", () => {
    const parsed = searchTermClassificationResponseSchema.safeParse({
      classifications: [
        {
          text: "wedding videographer jobs",
          intent: "irrelevant",
          recommendedAction: "delete_account",
          reason: "Job seekers, not customers.",
          confidence: 0.9,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("evidence", () => {
  it("requires the deterministic metrics that justify a recommendation", () => {
    const parsed = evidenceSchema.safeParse({
      windowStart: "2026-07-01",
      windowEnd: "2026-07-30",
      impressions: 1000,
      clicks: 100,
      cost: 147,
      conversions: 0,
      conversionValue: 0,
      roas: null,
      cpa: null,
      ctr: 0.1,
      conversionRate: 0,
      profit: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notes).toEqual([]);
  });

  it("rejects negative spend", () => {
    expect(
      evidenceSchema.safeParse({
        windowStart: "2026-07-01",
        windowEnd: "2026-07-30",
        impressions: 0,
        clicks: 0,
        cost: -10,
        conversions: 0,
        conversionValue: 0,
        roas: null,
        cpa: null,
        ctr: null,
        conversionRate: null,
        profit: null,
      }).success,
    ).toBe(false);
  });
});

describe("chat tool arguments", () => {
  it("caps the range a model can ask for", () => {
    expect(chatToolArgumentsSchema.safeParse({ days: 400 }).success).toBe(false);
    expect(chatToolArgumentsSchema.safeParse({ limit: 5000 }).success).toBe(false);
    expect(chatToolArgumentsSchema.safeParse({ days: 30, limit: 10 }).success).toBe(true);
  });

  it("rejects arguments that are not part of the contract", () => {
    expect(
      chatToolArgumentsSchema.safeParse({ organizationId: "someone-elses-org" }).success,
    ).toBe(false);
  });
});
