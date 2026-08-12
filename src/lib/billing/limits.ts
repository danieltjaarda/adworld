import "server-only";

import type { PlanTier } from "@/generated/prisma/enums";
import { limitsFor, planFor, type PlanLimits } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import { errors } from "@/lib/errors";

/**
 * Entitlement enforcement.
 *
 * Limits are checked server-side at the moment of the action, never in the UI alone.
 * A past-due subscription keeps read access but loses write features, because cutting
 * someone off from their own data over a failed card is hostile.
 */

export type UsageMetric = "ai_actions" | "chat_messages";

export type Entitlements = {
  plan: PlanTier;
  status: string;
  limits: PlanLimits;
  /** Write features are suspended while payment is failing. */
  writeEnabled: boolean;
};

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, "0")}`;
}

export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true, status: true },
  });

  const plan = subscription?.plan ?? "FREE";
  const status = subscription?.status ?? "ACTIVE";

  return {
    plan,
    status,
    limits: limitsFor(plan),
    writeEnabled: status === "ACTIVE" || status === "TRIALING",
  };
}

export async function countAccounts(organizationId: string): Promise<number> {
  return prisma.googleAdsAccount.count({ where: { organizationId, isActive: true, isDemo: false } });
}

export async function assertCanAddAccount(organizationId: string): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  const limit = entitlements.limits.accounts;
  if (limit === null) return;

  const used = await countAccounts(organizationId);
  if (used >= limit) {
    throw errors.planLimit(
      `The ${planFor(entitlements.plan).name} plan includes ${limit} Google Ads ${
        limit === 1 ? "account" : "accounts"
      }. Upgrade to connect more.`,
    );
  }
}

export async function assertCanInviteMember(organizationId: string): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  const limit = entitlements.limits.teamMembers;
  if (limit === null) return;

  const [members, invitations] = await Promise.all([
    prisma.organizationMember.count({ where: { organizationId } }),
    prisma.invitation.count({ where: { organizationId, acceptedAt: null } }),
  ]);

  if (members + invitations >= limit) {
    throw errors.planLimit(
      `The ${planFor(entitlements.plan).name} plan includes ${limit} team ${
        limit === 1 ? "member" : "members"
      }. Upgrade to add more.`,
    );
  }
}

export async function assertAutomaticModeAllowed(organizationId: string): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  if (!entitlements.limits.automaticMode) {
    throw errors.planLimit(
      "Automatic optimization is available on Growth and Agency. Approval mode is included in your plan.",
    );
  }
}

// ---------------------------------------------------------------------------
// Metered usage
// ---------------------------------------------------------------------------

export async function getUsage(organizationId: string, metric: UsageMetric): Promise<number> {
  const row = await prisma.usageCounter.findUnique({
    where: {
      organizationId_period_metric: { organizationId, period: currentPeriod(), metric },
    },
    select: { value: true },
  });
  return row?.value ?? 0;
}

export async function recordUsage(
  organizationId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  const period = currentPeriod();
  await prisma.usageCounter.upsert({
    where: { organizationId_period_metric: { organizationId, period, metric } },
    update: { value: { increment: amount } },
    create: { organizationId, period, metric, value: amount },
  });
}

function limitForMetric(limits: PlanLimits, metric: UsageMetric): number | null {
  return metric === "ai_actions" ? limits.aiActionsPerMonth : limits.chatMessagesPerMonth;
}

export async function assertWithinUsage(
  organizationId: string,
  metric: UsageMetric,
): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  const limit = limitForMetric(entitlements.limits, metric);
  if (limit === null) return;

  if (limit === 0) {
    throw errors.planLimit(
      metric === "ai_actions"
        ? "Applying changes to Google Ads requires a paid plan. You can keep reviewing recommendations for free."
        : "The AI assistant is not included in your plan.",
    );
  }

  const used = await getUsage(organizationId, metric);
  if (used >= limit) {
    throw errors.planLimit(
      metric === "ai_actions"
        ? `You have used all ${limit} AI changes included this month. Upgrade for more.`
        : `You have used all ${limit} AI messages included this month. Upgrade for more.`,
    );
  }
}

export async function assertWriteEnabled(organizationId: string): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  if (!entitlements.writeEnabled) {
    throw errors.planLimit(
      "Your subscription payment is failing, so changes are paused. Update your payment method to continue.",
    );
  }
}

export type UsageSnapshot = {
  entitlements: Entitlements;
  accounts: { used: number; limit: number | null };
  members: { used: number; limit: number | null };
  aiActions: { used: number; limit: number | null };
  chatMessages: { used: number; limit: number | null };
};

export async function getUsageSnapshot(organizationId: string): Promise<UsageSnapshot> {
  const entitlements = await getEntitlements(organizationId);

  const [accounts, members, aiActions, chatMessages] = await Promise.all([
    countAccounts(organizationId),
    prisma.organizationMember.count({ where: { organizationId } }),
    getUsage(organizationId, "ai_actions"),
    getUsage(organizationId, "chat_messages"),
  ]);

  return {
    entitlements,
    accounts: { used: accounts, limit: entitlements.limits.accounts },
    members: { used: members, limit: entitlements.limits.teamMembers },
    aiActions: { used: aiActions, limit: entitlements.limits.aiActionsPerMonth },
    chatMessages: { used: chatMessages, limit: entitlements.limits.chatMessagesPerMonth },
  };
}
