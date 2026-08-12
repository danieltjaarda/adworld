import "server-only";

import type Stripe from "stripe";

import { recordAudit } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { notify } from "@/lib/notifications/service";
import { getStripe } from "@/lib/stripe/client";
import { applyInvoiceStatus, syncSubscription } from "@/lib/stripe/subscriptions";

const log = createLogger("stripe.webhook");

/**
 * Webhook processing.
 *
 * Stripe retries aggressively and delivers out of order, so this is written to be
 * idempotent: every handler is a full-state sync rather than an incremental edit, and
 * seen event ids are recorded so a replay is a no-op.
 */

const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export function constructEvent(payload: string, signature: string | null): Stripe.Event {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw errors.configuration("Stripe webhooks are not configured.");
  if (!signature) throw errors.badRequest("Missing Stripe signature.");

  try {
    return getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    // A bad signature is either a misconfiguration or someone poking at the endpoint.
    throw errors.badRequest("Invalid Stripe signature.", { cause: String(error) });
  }
}

export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  if (!HANDLED_EVENTS.has(event.type)) {
    log.debug("ignoring event", { type: event.type });
    return { handled: false };
  }

  const fresh = await claimEvent(event);
  if (!fresh) {
    log.info("duplicate event ignored", { id: event.id, type: event.type });
    return { handled: true };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) break;

      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      await syncSubscription(subscription);

      const organizationId = session.client_reference_id ?? subscription.metadata?.organizationId;
      if (organizationId) {
        await recordAudit({
          organizationId,
          actorType: "SYSTEM",
          actorLabel: "Stripe",
          action: "billing.subscription.started",
          entityType: "subscription",
          entityId: subscription.id,
          summary: `Subscription started (${session.metadata?.tier ?? "unknown"} plan)`,
          ipAddress: null,
          userAgent: null,
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object);
      break;
    }

    case "invoice.paid": {
      const customerId = customerIdOf(event.data.object);
      if (customerId) await applyInvoiceStatus(customerId, "ACTIVE");
      break;
    }

    case "invoice.payment_failed": {
      const customerId = customerIdOf(event.data.object);
      if (!customerId) break;

      await applyInvoiceStatus(customerId, "PAST_DUE");

      const subscription = await prisma.subscription.findUnique({
        where: { stripeCustomerId: customerId },
        select: { organizationId: true },
      });

      // Telling people beats a silent loss of automation three days later.
      if (subscription) {
        await notify({
          organizationId: subscription.organizationId,
          type: "BILLING",
          severity: "WARNING",
          title: "Payment failed",
          body: "We could not charge your card. Automatic changes are paused until the payment goes through.",
          href: "/billing",
          dedupeKey: `billing:payment_failed:${event.data.object.id ?? event.id}`,
          email: { accountName: "your workspace" },
        });
      }
      break;
    }
  }

  log.info("event handled", { id: event.id, type: event.type });
  return { handled: true };
}

function customerIdOf(invoice: Stripe.Invoice): string | null {
  if (!invoice.customer) return null;
  return typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;
}

/**
 * Records the event id and reports whether this delivery is the first one. The unique
 * constraint does the work, so two concurrent deliveries cannot both win.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: { provider: "stripe", eventId: event.id, type: String(event.type) },
    });
    return true;
  } catch {
    return false;
  }
}
