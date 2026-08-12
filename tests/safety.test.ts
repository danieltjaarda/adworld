import { describe, expect, it } from "vitest";

import type { ActionPayload } from "@/lib/ai/schemas";
import { settingsFixture } from "./fixtures";
import {
  FORBIDDEN_OPERATIONS,
  HARD_LIMITS,
  clampBid,
  clampBudget,
  decideExecution,
  enforceSafety,
  isForbiddenOperation,
  scoreRisk,
} from "@/lib/optimization/safety";

/**
 * The safety engine is the last thing standing between a language model and someone's
 * ad budget, so it gets the most direct tests in the suite.
 */

const settings = settingsFixture();

describe("clampBudget", () => {
  it("caps an increase at the configured percentage", () => {
    const result = clampBudget(50, 100, settings);

    expect(result.value).toBe(60);
    expect(result.clamped).toBe(true);
    expect(result.reason).toContain("+20%");
  });

  it("caps a decrease at the configured percentage", () => {
    const result = clampBudget(50, 10, settings);

    expect(result.value).toBe(40);
    expect(result.clamped).toBe(true);
  });

  it("never exceeds the account maximum, even within the percentage limit", () => {
    const result = clampBudget(190, 228, settings);

    expect(result.value).toBe(200);
    expect(result.reason).toContain("account maximum");
  });

  it("ignores a user limit that is more permissive than the hard limit", () => {
    const reckless = { ...settings, maxDailyBudgetIncreasePct: 5000, maxDailyBudget: null };
    const result = clampBudget(50, 10_000, reckless);

    expect(result.value).toBe(50 * (1 + HARD_LIMITS.maxBudgetIncreasePct / 100));
  });

  it("leaves a change inside the limits untouched", () => {
    const result = clampBudget(50, 55, settings);

    expect(result.value).toBe(55);
    expect(result.clamped).toBe(false);
    expect(result.reason).toBeNull();
  });
});

describe("clampBid", () => {
  it("caps a bid increase at the configured percentage", () => {
    expect(clampBid(1, 5, settings).value).toBe(1.2);
  });

  it("keeps bids inside the absolute bounds", () => {
    expect(clampBid(0, 1000, settings).value).toBe(HARD_LIMITS.maxBid);
    expect(clampBid(0, 0.001, settings).value).toBe(HARD_LIMITS.minBid);
  });
});

describe("enforceSafety", () => {
  const increase: ActionPayload = {
    action: "increase_budget",
    campaignId: "123",
    budgetId: "456",
    currentBudget: 50,
    recommendedBudget: 500,
  };

  it("rewrites an over-ambitious budget instead of rejecting it", () => {
    const verdict = enforceSafety(increase, settings);

    expect(verdict.allowed).toBe(true);
    if (verdict.allowed && verdict.payload.action === "increase_budget") {
      expect(verdict.payload.recommendedBudget).toBe(60);
      expect(verdict.adjustments.join(" ")).toContain("capped");
    }
  });

  it("refuses a change that clamping would reverse", () => {
    const verdict = enforceSafety(
      { ...increase, currentBudget: 100, recommendedBudget: 10 },
      settings,
    );

    expect(verdict.allowed).toBe(false);
  });

  it("refuses a campaign-level negative without a campaign", () => {
    const verdict = enforceSafety(
      {
        action: "add_negative_keyword",
        level: "CAMPAIGN",
        campaignId: null,
        adGroupId: null,
        text: "jobs",
        matchType: "PHRASE",
      },
      settings,
    );

    expect(verdict.allowed).toBe(false);
  });

  it("refuses ad copy that would be rejected by Google anyway", () => {
    const verdict = enforceSafety(
      {
        action: "create_ad_variant",
        adGroupId: "1",
        sourceAdId: null,
        headlines: ["This headline is far too long to be accepted by Google Ads"],
        descriptions: ["A description", "Another description"],
        finalUrl: "https://example.com",
        path1: null,
        path2: null,
      },
      settings,
    );

    expect(verdict.allowed).toBe(false);
  });
});

describe("decideExecution", () => {
  const budgetChange: ActionPayload = {
    action: "increase_budget",
    campaignId: "1",
    budgetId: "2",
    currentBudget: 50,
    recommendedBudget: 60,
  };
  const context = { confidence: 0.9, risk: "LOW" } as const;

  it("blocks every write in suggestions mode", () => {
    const decision = decideExecution(budgetChange, { ...settings, mode: "SUGGESTIONS" }, context);

    expect(decision.canAutoExecute).toBe(false);
    expect(decision.canExecuteOnApproval).toBe(false);
  });

  it("allows approval but not automation in approval mode", () => {
    const decision = decideExecution(budgetChange, { ...settings, mode: "APPROVAL" }, context);

    expect(decision.canAutoExecute).toBe(false);
    expect(decision.canExecuteOnApproval).toBe(true);
  });

  it("automates only the switched-on change types", () => {
    expect(decideExecution(budgetChange, settings, context).canAutoExecute).toBe(true);
    expect(
      decideExecution(budgetChange, { ...settings, autoBudgetChanges: false }, context)
        .canAutoExecute,
    ).toBe(false);
  });

  it("never automates a high-risk change or one below the confidence threshold", () => {
    expect(
      decideExecution(budgetChange, settings, { confidence: 0.95, risk: "HIGH" }).canAutoExecute,
    ).toBe(false);
    expect(
      decideExecution(budgetChange, settings, { confidence: 0.5, risk: "LOW" }).canAutoExecute,
    ).toBe(false);
  });

  it("always requires a person to pause a campaign", () => {
    const decision = decideExecution({ action: "pause_campaign", campaignId: "1" }, settings, context);

    expect(decision.canAutoExecute).toBe(false);
    expect(decision.canExecuteOnApproval).toBe(true);
  });
});

describe("forbidden operations", () => {
  it("recognises destructive operations", () => {
    for (const operation of FORBIDDEN_OPERATIONS) {
      expect(isForbiddenOperation(operation)).toBe(true);
    }
    expect(isForbiddenOperation("increase_budget")).toBe(false);
  });
});

describe("scoreRisk", () => {
  it("treats large, weakly-evidenced changes as high risk", () => {
    expect(
      scoreRisk({
        action: "increase_budget",
        monthlyExposure: 5000,
        spendShare: 0.6,
        dataStrength: 0.2,
        reversible: true,
      }),
    ).toBe("HIGH");
  });

  it("treats a reversible negative keyword on a small term as low risk", () => {
    expect(
      scoreRisk({
        action: "add_negative_keyword",
        monthlyExposure: 60,
        spendShare: 0.02,
        dataStrength: 0.9,
        reversible: true,
      }),
    ).toBe("LOW");
  });
});
