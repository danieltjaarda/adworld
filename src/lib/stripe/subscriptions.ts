import "server-only";

import type Stripe from "stripe";

import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { PLANS, PLAN_ORDER } from "@/lib/billing/plans";

const log = createLogger("stripe.subscriptions");

/**
 * Translation layer between Stripe's vocabulary and ours.
 *
 * Stripe is the source of truth for *what someone pays*; this database is the source of
 * truth for *what they may do*. The webhook keeps the second in step with the first, and
 * every write is keyed on the Stripe object id so replayed events are harmless.
 */

/** price id -> plan, built from env so prices can change without a code change. */
export function priceMap(): Map<string, PlanTier> {
  const env = getEnv();
  const map = new Map<string, PlanTier>();

  for (const tier of PLAN_ORDER) {
    const key = PLANS[tier].priceEnvKey;
    if (!key) continue;
    const priceId = env[key as keyof typeof env];
    if (typeof priceId === "string" && priceId) map.set(priceId, tier);
  }

  return map;
}

export function priceIdFor(tier: PlanTier): string | null {
  const key = PLANS[tier].priceEnvKey;
  if (!key) return null;
  const value = getEnv()[key as keyof ReturnType<typeof getEnv>];
  return typeof value === "string" && value ? value : null;
}

export function planForPrice(priceId: string | null | undefined): PlanTier {
  if (!priceId) return "FREE";
  return priceMap().get(priceId) ?? "FREE";
}

const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
  unpaid: "UNPAID",
  paused: "PAUSED",
};

export function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  return STATUS_MAP[status] ?? "INCOMPLETE";
}

function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * Applies a Stripe subscription to the workspace it belongs to. Called from the webhook
 * and immediately after checkout so the UI does not have to wait for the event to land.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const organizationId = await resolveOrganizationId(subscription);
  if (!organizationId) {
    log.warn("subscription without a known organization", { subscriptionId: subscription.id });
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = planForPrice(priceId);
  const status = mapStatus(subscription.status);

  // A cancelled subscription drops the workspace to Free rather than locking it out:
  // people keep their history and read access, they just lose paid capabilities.
  const effectivePlan = status === "CANCELED" ? "FREE" : plan;

  await prisma.subscription.upsert({
    where: { organizationId },
    update: {
      plan: effectivePlan,
      status,
      stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: toDate(item?.current_period_start),
      currentPeriodEnd: toDate(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
      seats: item?.quantity ?? 1,
    },
    create: {
      organizationId,
      plan: effectivePlan,
      status,
      stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: toDate(item?.current_period_start),
      currentPeriodEnd: toDate(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
      seats: item?.quantity ?? 1,
    },
  });

  log.info("subscription synced", { organizationId, plan: effectivePlan, status });
}

/**
 * Three ways to find the workspace, in order of reliability: the metadata we set at
 * checkout, the subscription id we already stored, then the customer id.
 */
async function resolveOrganizationId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.organizationId;
  if (fromMetadata) {
    const exists = await prisma.organization.findUnique({
      where: { id: fromMetadata },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  const bySubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { organizationId: true },
  });
  if (bySubscription) return bySubscription.organizationId;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const byCustomer = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { organizationId: true },
  });

  return byCustomer?.organizationId ?? null;
}

/** Payment failures and recoveries arrive as invoice events, not subscription events. */
export async function applyInvoiceStatus(
  customerId: string,
  status: SubscriptionStatus,
): Promise<void> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { organizationId: true, status: true },
  });
  if (!existing || existing.status === status) return;

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: { status },
  });

  log.info("subscription status from invoice", { organizationId: existing.organizationId, status });
}
