import type { PlanTier } from "@/generated/prisma/enums";

/**
 * Plan catalogue.
 *
 * Prices live in Stripe, not here — this file describes what a plan *allows*, which is
 * what the application has to enforce. Changing a price never requires a deploy;
 * changing an entitlement does, and that is intentional.
 */

export type PlanLimits = {
  /** Linked Google Ads accounts. null means unlimited. */
  accounts: number | null;
  teamMembers: number | null;
  /** AI-executed changes per calendar month. */
  aiActionsPerMonth: number | null;
  chatMessagesPerMonth: number | null;
  /** Automatic mode is the feature people upgrade for. */
  automaticMode: boolean;
  scheduledReports: boolean;
  prioritySupport: boolean;
  historyDays: number;
};

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  tagline: string;
  /** Indicative monthly price in euros, shown until Stripe prices are configured. */
  indicativePrice: number | null;
  priceEnvKey: string | null;
  limits: PlanLimits;
  highlights: string[];
};

export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: "FREE",
    name: "Free",
    tagline: "See what the optimizer finds in your account.",
    indicativePrice: 0,
    priceEnvKey: null,
    limits: {
      accounts: 1,
      teamMembers: 1,
      aiActionsPerMonth: 0,
      chatMessagesPerMonth: 30,
      automaticMode: false,
      scheduledReports: false,
      prioritySupport: false,
      historyDays: 30,
    },
    highlights: [
      "1 Google Ads account",
      "Daily sync and analysis",
      "Recommendations with full reasoning",
      "Suggestions mode only",
    ],
  },
  STARTER: {
    tier: "STARTER",
    name: "Starter",
    tagline: "Approve changes and let the agent do the work.",
    indicativePrice: 49,
    priceEnvKey: "STRIPE_PRICE_STARTER",
    limits: {
      accounts: 1,
      teamMembers: 3,
      aiActionsPerMonth: 200,
      chatMessagesPerMonth: 500,
      automaticMode: false,
      scheduledReports: true,
      prioritySupport: false,
      historyDays: 180,
    },
    highlights: [
      "1 Google Ads account",
      "Approval mode with one-click apply",
      "Anomaly alerts by email",
      "Weekly performance report",
    ],
  },
  GROWTH: {
    tier: "GROWTH",
    name: "Growth",
    tagline: "Hands-off optimization with safety limits you control.",
    indicativePrice: 149,
    priceEnvKey: "STRIPE_PRICE_GROWTH",
    limits: {
      accounts: 5,
      teamMembers: 10,
      aiActionsPerMonth: 2000,
      chatMessagesPerMonth: 3000,
      automaticMode: true,
      scheduledReports: true,
      prioritySupport: false,
      historyDays: 365,
    },
    highlights: [
      "5 Google Ads accounts",
      "Automatic optimization",
      "Profit-based optimization",
      "Full audit log and rollback",
    ],
  },
  AGENCY: {
    tier: "AGENCY",
    name: "Agency",
    tagline: "Every client account in one workspace.",
    indicativePrice: 399,
    priceEnvKey: "STRIPE_PRICE_AGENCY",
    limits: {
      accounts: null,
      teamMembers: null,
      aiActionsPerMonth: null,
      chatMessagesPerMonth: null,
      automaticMode: true,
      scheduledReports: true,
      prioritySupport: true,
      historyDays: 730,
    },
    highlights: [
      "Unlimited Google Ads accounts",
      "Unlimited team members",
      "Priority support",
      "Everything in Growth",
    ],
  },
};

export const PLAN_ORDER: PlanTier[] = ["FREE", "STARTER", "GROWTH", "AGENCY"];

export function planFor(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}

export function limitsFor(tier: PlanTier): PlanLimits {
  return PLANS[tier].limits;
}

export function isUpgrade(from: PlanTier, to: PlanTier): boolean {
  return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

export function describeLimit(value: number | null): string {
  return value === null ? "Unlimited" : String(value);
}
