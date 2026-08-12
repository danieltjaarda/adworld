import type { ActionPayload } from "@/lib/ai/schemas";
import type { AccountSettings } from "@/lib/analytics/queries";
import { clamp, safeDivide } from "@/lib/utils";

/**
 * The safety engine.
 *
 * Everything the optimizer wants to change passes through here twice: once when the
 * recommendation is created, and again immediately before execution. It is pure and
 * synchronous on purpose — no database, no network — so it can be exhaustively tested
 * and reasoned about.
 *
 * User-configurable limits can only ever make the system *more* conservative. The
 * hard limits below cannot be raised from the UI, the API, or by the model.
 */

export const HARD_LIMITS = {
  /** A single budget change may never more than double a budget. */
  maxBudgetIncreasePct: 100,
  /** A single budget change may never cut more than half. */
  maxBudgetDecreasePct: 50,
  maxBidChangePct: 50,
  minDailyBudget: 1,
  maxDailyBudget: 100_000,
  minBid: 0.05,
  maxBid: 500,
  maxActionsPerRun: 100,
} as const;

/**
 * Operations the system will never perform, regardless of mode or settings. They are
 * absent from the action union as well; this list exists so the rule is explicit,
 * auditable, and covered by a test.
 */
export const FORBIDDEN_OPERATIONS = [
  "delete_campaign",
  "delete_ad_group",
  "delete_keyword",
  "change_conversion_tracking",
  "change_account_settings",
  "change_billing_settings",
  "change_bidding_strategy",
  "remove_conversion_action",
] as const;

export type ForbiddenOperation = (typeof FORBIDDEN_OPERATIONS)[number];

export function isForbiddenOperation(operation: string): boolean {
  return (FORBIDDEN_OPERATIONS as readonly string[]).includes(operation);
}

// ---------------------------------------------------------------------------
// Numeric clamping
// ---------------------------------------------------------------------------

export type ClampResult = {
  value: number;
  requested: number;
  clamped: boolean;
  reason: string | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Clamps a proposed daily budget to the user's percentage limits, the account's
 * absolute maximum and the hard system bounds.
 */
export function clampBudget(
  currentBudget: number,
  proposedBudget: number,
  settings: Pick<
    AccountSettings,
    "maxDailyBudgetIncreasePct" | "maxDailyBudgetDecreasePct" | "maxDailyBudget"
  >,
): ClampResult {
  const requested = round2(proposedBudget);
  const reasons: string[] = [];
  let value = requested;

  const increaseLimit = Math.min(
    Math.max(settings.maxDailyBudgetIncreasePct, 0),
    HARD_LIMITS.maxBudgetIncreasePct,
  );
  const decreaseLimit = Math.min(
    Math.max(settings.maxDailyBudgetDecreasePct, 0),
    HARD_LIMITS.maxBudgetDecreasePct,
  );

  if (currentBudget > 0) {
    const ceiling = round2(currentBudget * (1 + increaseLimit / 100));
    const floor = round2(currentBudget * (1 - decreaseLimit / 100));

    if (value > ceiling) {
      value = ceiling;
      reasons.push(`capped at +${increaseLimit}% per change`);
    }
    if (value < floor) {
      value = floor;
      reasons.push(`capped at -${decreaseLimit}% per change`);
    }
  }

  if (settings.maxDailyBudget !== null && settings.maxDailyBudget !== undefined) {
    const absoluteMax = Math.min(settings.maxDailyBudget, HARD_LIMITS.maxDailyBudget);
    if (value > absoluteMax) {
      value = round2(absoluteMax);
      reasons.push(`capped at the account maximum of ${absoluteMax}/day`);
    }
  }

  value = clamp(value, HARD_LIMITS.minDailyBudget, HARD_LIMITS.maxDailyBudget);

  return {
    value: round2(value),
    requested,
    clamped: value !== requested,
    reason: reasons.length > 0 ? reasons.join(" and ") : null,
  };
}

export function clampBid(
  currentBid: number,
  proposedBid: number,
  settings: Pick<AccountSettings, "maxBidChangePct">,
): ClampResult {
  const requested = round2(proposedBid);
  const limit = Math.min(Math.max(settings.maxBidChangePct, 0), HARD_LIMITS.maxBidChangePct);
  const reasons: string[] = [];
  let value = requested;

  if (currentBid > 0) {
    const ceiling = round2(currentBid * (1 + limit / 100));
    const floor = round2(currentBid * (1 - limit / 100));
    if (value > ceiling) {
      value = ceiling;
      reasons.push(`capped at +${limit}% per change`);
    }
    if (value < floor) {
      value = floor;
      reasons.push(`capped at -${limit}% per change`);
    }
  }

  value = clamp(value, HARD_LIMITS.minBid, HARD_LIMITS.maxBid);

  return {
    value: round2(value),
    requested,
    clamped: value !== requested,
    reason: reasons.length > 0 ? reasons.join(" and ") : null,
  };
}

// ---------------------------------------------------------------------------
// Action-level validation
// ---------------------------------------------------------------------------

export type SafetyVerdict =
  | { allowed: true; payload: ActionPayload; adjustments: string[] }
  | { allowed: false; reason: string };

/**
 * Re-validates a payload against the account's current limits and returns a possibly
 * adjusted payload. Called both when a recommendation is generated and again right
 * before it is sent to Google, because settings may have changed in between.
 */
export function enforceSafety(payload: ActionPayload, settings: AccountSettings): SafetyVerdict {
  const adjustments: string[] = [];

  switch (payload.action) {
    case "increase_budget":
    case "decrease_budget": {
      if (payload.currentBudget < 0 || payload.recommendedBudget <= 0) {
        return { allowed: false, reason: "Budget values must be positive." };
      }

      const result = clampBudget(payload.currentBudget, payload.recommendedBudget, settings);
      if (result.reason) adjustments.push(`Budget ${result.reason}.`);

      if (Math.abs(result.value - payload.currentBudget) < 0.01) {
        return {
          allowed: false,
          reason: "The change is already at the configured budget limit, so there is nothing to apply.",
        };
      }

      // Direction must still match the action after clamping.
      const increasing = result.value > payload.currentBudget;
      if (payload.action === "increase_budget" && !increasing) {
        return { allowed: false, reason: "Safety limits turned this increase into a decrease." };
      }
      if (payload.action === "decrease_budget" && increasing) {
        return { allowed: false, reason: "Safety limits turned this decrease into an increase." };
      }

      return {
        allowed: true,
        payload: { ...payload, recommendedBudget: result.value },
        adjustments,
      };
    }

    case "increase_keyword_bid":
    case "decrease_keyword_bid": {
      if (payload.recommendedBid <= 0) {
        return { allowed: false, reason: "Bid values must be positive." };
      }

      const result = clampBid(payload.currentBid, payload.recommendedBid, settings);
      if (result.reason) adjustments.push(`Bid ${result.reason}.`);

      if (Math.abs(result.value - payload.currentBid) < 0.01) {
        return {
          allowed: false,
          reason: "The change is already at the configured bid limit, so there is nothing to apply.",
        };
      }

      return { allowed: true, payload: { ...payload, recommendedBid: result.value }, adjustments };
    }

    case "add_negative_keyword": {
      if (payload.level === "CAMPAIGN" && !payload.campaignId) {
        return { allowed: false, reason: "A campaign-level negative needs a campaign." };
      }
      if (payload.level === "AD_GROUP" && !payload.adGroupId) {
        return { allowed: false, reason: "An ad group-level negative needs an ad group." };
      }
      if (payload.text.trim().length < 2) {
        return { allowed: false, reason: "Negative keyword text is too short to be safe." };
      }
      return { allowed: true, payload, adjustments };
    }

    case "add_keyword": {
      if (payload.text.trim().length < 2) {
        return { allowed: false, reason: "Keyword text is too short." };
      }
      if (payload.cpcBid !== null) {
        const bid = clamp(payload.cpcBid, HARD_LIMITS.minBid, HARD_LIMITS.maxBid);
        if (bid !== payload.cpcBid) adjustments.push("Bid clamped to the allowed range.");
        return { allowed: true, payload: { ...payload, cpcBid: bid }, adjustments };
      }
      return { allowed: true, payload, adjustments };
    }

    case "create_ad_variant": {
      if (payload.headlines.length < 3) {
        return { allowed: false, reason: "A responsive search ad needs at least 3 headlines." };
      }
      if (payload.headlines.some((headline) => headline.length > 30)) {
        return { allowed: false, reason: "Headlines must be 30 characters or fewer." };
      }
      if (payload.descriptions.some((description) => description.length > 90)) {
        return { allowed: false, reason: "Descriptions must be 90 characters or fewer." };
      }
      return { allowed: true, payload, adjustments };
    }

    case "pause_campaign":
      // Allowed, but never automatically — see `requiresApproval` below.
      return { allowed: true, payload, adjustments };

    case "pause_keyword":
    case "enable_keyword":
    case "pause_ad":
    case "review_conversion_tracking":
    case "monitor":
      return { allowed: true, payload, adjustments };
  }
}

// ---------------------------------------------------------------------------
// Mode gating
// ---------------------------------------------------------------------------

export type ExecutionDecision = {
  /** May the system apply this without a human clicking approve? */
  canAutoExecute: boolean;
  /** May a human approve it for execution at all in the current mode? */
  canExecuteOnApproval: boolean;
  reason: string;
};

/** Actions that always need a person, no matter how the account is configured. */
const ALWAYS_MANUAL: ReadonlySet<ActionPayload["action"]> = new Set([
  "pause_campaign",
  "review_conversion_tracking",
  "monitor",
]);

const AUTO_TOGGLE_BY_ACTION: Record<
  ActionPayload["action"],
  keyof Pick<
    AccountSettings,
    | "autoNegativeKeywords"
    | "autoAddKeywords"
    | "autoBidChanges"
    | "autoBudgetChanges"
    | "autoPauseKeywords"
    | "autoPauseAds"
  > | null
> = {
  increase_budget: "autoBudgetChanges",
  decrease_budget: "autoBudgetChanges",
  increase_keyword_bid: "autoBidChanges",
  decrease_keyword_bid: "autoBidChanges",
  add_negative_keyword: "autoNegativeKeywords",
  add_keyword: "autoAddKeywords",
  pause_keyword: "autoPauseKeywords",
  enable_keyword: "autoPauseKeywords",
  pause_ad: "autoPauseAds",
  create_ad_variant: null,
  pause_campaign: null,
  review_conversion_tracking: null,
  monitor: null,
};

export function decideExecution(
  payload: ActionPayload,
  settings: AccountSettings,
  context: { confidence: number; risk: "LOW" | "MEDIUM" | "HIGH" },
): ExecutionDecision {
  if (settings.mode === "SUGGESTIONS") {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: false,
      reason:
        "This account is in Suggestions mode, so AdLeverage never changes Google Ads. Switch to Approval mode to apply changes.",
    };
  }

  if (ALWAYS_MANUAL.has(payload.action)) {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: payload.action === "pause_campaign",
      reason: "This action always requires a person to approve it.",
    };
  }

  if (settings.mode === "APPROVAL") {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: true,
      reason: "Approval mode: changes are prepared and wait for your approval.",
    };
  }

  const toggle = AUTO_TOGGLE_BY_ACTION[payload.action];
  if (!toggle || !settings[toggle]) {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: true,
      reason: "Automatic execution is switched off for this type of change.",
    };
  }

  if (context.risk === "HIGH") {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: true,
      reason: "High-risk changes are never applied automatically.",
    };
  }

  if (context.confidence < settings.minConfidence) {
    return {
      canAutoExecute: false,
      canExecuteOnApproval: true,
      reason: `Confidence ${(context.confidence * 100).toFixed(0)}% is below the ${(
        settings.minConfidence * 100
      ).toFixed(0)}% threshold for automatic changes.`,
    };
  }

  return {
    canAutoExecute: true,
    canExecuteOnApproval: true,
    reason: "Automatic mode: this change is applied without waiting for approval.",
  };
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

export type RiskInput = {
  action: ActionPayload["action"];
  /** Money at stake per month if the change is wrong. */
  monthlyExposure: number;
  /** Share of account spend the affected entity represents, 0–1. */
  spendShare: number;
  dataStrength: number;
  reversible: boolean;
};

export function scoreRisk(input: RiskInput): "LOW" | "MEDIUM" | "HIGH" {
  let score = 0;

  if (input.monthlyExposure > 1000) score += 2;
  else if (input.monthlyExposure > 250) score += 1;

  if (input.spendShare > 0.4) score += 2;
  else if (input.spendShare > 0.15) score += 1;

  if (input.dataStrength < 0.4) score += 2;
  else if (input.dataStrength < 0.7) score += 1;

  if (!input.reversible) score += 2;

  if (input.action === "pause_campaign") score += 2;
  if (input.action === "add_negative_keyword" || input.action === "monitor") score -= 1;

  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * Confidence from evidence, not from vibes. Sample size and effect size drive it;
 * the model may only lower it, never raise it above this ceiling.
 */
export function scoreConfidence(input: {
  dataStrength: number;
  effectSize: number;
  consistency: number;
}): number {
  const base = 0.45 + input.dataStrength * 0.3 + input.effectSize * 0.15 + input.consistency * 0.1;
  return Math.round(clamp(base, 0.3, 0.98) * 100) / 100;
}

/** How far a value sits from a target, expressed 0–1 for effect-size scoring. */
export function relativeGap(value: number | null, target: number | null): number {
  if (value === null || target === null || target === 0) return 0.3;
  const gap = Math.abs(safeDivide(value - target, target) ?? 0);
  return clamp(gap, 0, 1);
}
