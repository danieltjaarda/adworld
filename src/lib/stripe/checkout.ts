import "server-only";

import type Stripe from "stripe";

import type { PlanTier } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/env";
import { errors } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe/client";
import { priceIdFor, syncSubscription } from "@/lib/stripe/subscriptions";

const log = createLogger("stripe.checkout");

/**
 * Checkout and portal sessions. Both are short-lived redirects created server-side; the
 * browser never sees a Stripe secret, only the one-time URL.
 */

/** One Stripe customer per workspace, created lazily on the first billing interaction. */
export async function ensureCustomer(organizationId: string): Promise<string> {
  const stripe = getStripe();

  const [subscription, organization] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId },
      select: { stripeCustomerId: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        members: {
          where: { role: "OWNER" },
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { user: { select: { email: true, name: true } } },
        },
      },
    }),
  ]);

  if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;
  if (!organization) throw errors.notFound("That workspace no longer exists.");

  const owner = organization.members[0]?.user;

  const customer = await stripe.customers.create(
    {
      name: organization.name,
      email: owner?.email,
      metadata: { organizationId },
    },
    // Retrying a failed create must not leave two customers behind.
    { idempotencyKey: `customer:${organizationId}` },
  );

  await prisma.subscription.upsert({
    where: { organizationId },
    update: { stripeCustomerId: customer.id },
    create: { organizationId, stripeCustomerId: customer.id, plan: "FREE", status: "ACTIVE" },
  });

  log.info("stripe customer created", { organizationId, customerId: customer.id });
  return customer.id;
}

export async function createCheckoutSession(options: {
  organizationId: string;
  tier: PlanTier;
  userEmail: string;
}): Promise<string> {
  const priceId = priceIdFor(options.tier);
  if (!priceId) {
    throw errors.configuration(
      "That plan is not available for self-serve checkout yet. Get in touch and we will set it up.",
    );
  }

  const stripe = getStripe();
  const customerId = await ensureCustomer(options.organizationId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: options.organizationId,
    subscription_data: {
      metadata: { organizationId: options.organizationId },
    },
    metadata: { organizationId: options.organizationId, tier: options.tier },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    automatic_tax: { enabled: false },
    success_url: appUrl("/billing?checkout=success"),
    cancel_url: appUrl("/billing?checkout=cancelled"),
  });

  if (!session.url) throw errors.stripe("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortalSession(organizationId: string): Promise<string> {
  const stripe = getStripe();
  const customerId = await ensureCustomer(organizationId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl("/billing"),
  });

  return session.url;
}

/**
 * Pulls the current subscription straight from Stripe after checkout so the plan is
 * correct on the next render, instead of waiting for the webhook to arrive.
 */
export async function refreshFromStripe(organizationId: string): Promise<void> {
  const record = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { stripeCustomerId: true },
  });
  if (!record?.stripeCustomerId) return;

  try {
    const stripe = getStripe();
    const list = await stripe.subscriptions.list({
      customer: record.stripeCustomerId,
      status: "all",
      limit: 1,
    });

    const subscription: Stripe.Subscription | undefined = list.data[0];
    if (subscription) await syncSubscription(subscription);
  } catch (error) {
    // The webhook is the reliable path; this is only an optimization.
    log.warn("could not refresh subscription from Stripe", { organizationId, error });
  }
}

export async function listInvoices(organizationId: string, limit = 12) {
  const record = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { stripeCustomerId: true },
  });
  if (!record?.stripeCustomerId) return [];

  try {
    const stripe = getStripe();
    const invoices = await stripe.invoices.list({ customer: record.stripeCustomerId, limit });

    return invoices.data.map((invoice) => ({
      id: invoice.id ?? "",
      number: invoice.number,
      status: invoice.status,
      total: invoice.total,
      currency: invoice.currency.toUpperCase(),
      createdAt: new Date(invoice.created * 1000),
      hostedUrl: invoice.hosted_invoice_url,
      pdfUrl: invoice.invoice_pdf,
    }));
  } catch (error) {
    log.warn("could not list invoices", { organizationId, error });
    return [];
  }
}
