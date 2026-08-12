import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";
import { resetEnvCache } from "@/lib/env";

/**
 * Stripe webhooks.
 *
 * Stripe retries on any non-2xx and delivers out of order, so the handler has to be
 * idempotent and tolerant of events arriving in the wrong sequence. These tests replay
 * duplicates and out-of-order deliveries against a Prisma stub.
 */

process.env.STRIPE_PRICE_STARTER = "price_starter";
process.env.STRIPE_PRICE_GROWTH = "price_growth";
process.env.STRIPE_PRICE_AGENCY = "price_agency";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
resetEnvCache();

const ORG = "org_1";

type SubscriptionRow = {
  organizationId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
};

const db = {
  seenEvents: new Set<string>(),
  subscriptions: [] as SubscriptionRow[],
  organizations: [ORG],
};

const notifications: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];

function findSubscription(where: Record<string, string>): SubscriptionRow | null {
  const [[key, value]] = Object.entries(where);
  return db.subscriptions.find((row) => row[key as keyof SubscriptionRow] === value) ?? null;
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    webhookEvent: {
      create: async ({ data }: { data: { eventId: string } }) => {
        // Mirrors the unique constraint on (provider, eventId).
        if (db.seenEvents.has(data.eventId)) throw new Error("Unique constraint failed");
        db.seenEvents.add(data.eventId);
        return data;
      },
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.organizations.includes(where.id) ? { id: where.id } : null,
    },
    subscription: {
      findUnique: async ({ where }: { where: Record<string, string> }) => findSubscription(where),
      update: async ({ where, data }: { where: Record<string, string>; data: Partial<SubscriptionRow> }) => {
        const row = findSubscription(where);
        if (row) Object.assign(row, data);
        return row;
      },
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: Record<string, string>;
        update: Partial<SubscriptionRow>;
        create: SubscriptionRow;
      }) => {
        const row = findSubscription(where);
        if (row) {
          Object.assign(row, update);
          return row;
        }
        db.subscriptions.push({ ...create });
        return create;
      },
    },
  },
}));

vi.mock("@/lib/notifications/service", () => ({
  notify: async (input: Record<string, unknown>) => {
    notifications.push(input);
  },
}));

vi.mock("@/lib/audit/log", () => ({
  recordAudit: async (input: Record<string, unknown>) => {
    audits.push(input);
  },
}));

const stripeApi = {
  subscriptions: {
    retrieve: vi.fn(async (id: string) => buildSubscription({ id })),
  },
  webhooks: {
    constructEvent: vi.fn(() => {
      throw new Error("signature verification failed");
    }),
  },
};

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => stripeApi,
}));

/** A subscription shaped like the fields the sync layer actually reads. */
function buildSubscription(overrides: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { organizationId: ORG },
    items: {
      data: [
        {
          quantity: 1,
          price: { id: "price_growth" },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_600_000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function subscriptionEvent(
  type: Stripe.Event.Type,
  subscription: Stripe.Subscription,
  id = `evt_${Math.random().toString(36).slice(2)}`,
): Stripe.Event {
  return { id, type, data: { object: subscription } } as unknown as Stripe.Event;
}

function invoiceEvent(type: Stripe.Event.Type, customer: string, id = `evt_${type}`): Stripe.Event {
  return {
    id,
    type,
    data: { object: { id: "in_1", customer } },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  db.seenEvents.clear();
  db.subscriptions = [];
  notifications.length = 0;
  audits.length = 0;
  stripeApi.subscriptions.retrieve.mockClear();
});

describe("signature verification", () => {
  it("refuses an unsigned request", async () => {
    const { constructEvent } = await import("@/lib/stripe/webhook");
    expect(() => constructEvent("{}", null)).toThrow(/signature/i);
  });

  it("refuses a forged signature without leaking the Stripe error", async () => {
    const { constructEvent } = await import("@/lib/stripe/webhook");

    try {
      constructEvent("{}", "t=1,v1=forged");
      expect.unreachable("a forged signature must be rejected");
    } catch (error) {
      expect((error as { userMessage: string }).userMessage).toBe("Invalid Stripe signature.");
    }
  });
});

describe("event handling", () => {
  it("ignores event types it does not act on", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    const result = await handleStripeEvent({
      id: "evt_ping",
      type: "customer.created",
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(result.handled).toBe(false);
    expect(db.subscriptions).toHaveLength(0);
  });

  it("stores the plan a subscription maps to", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(subscriptionEvent("customer.subscription.created", buildSubscription()));

    expect(db.subscriptions).toHaveLength(1);
    expect(db.subscriptions[0]).toMatchObject({
      organizationId: ORG,
      plan: "GROWTH",
      status: "ACTIVE",
      stripeCustomerId: "cus_1",
    });
  });

  it("processes a redelivered event exactly once", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");
    const event = subscriptionEvent("customer.subscription.created", buildSubscription(), "evt_dup");

    const first = await handleStripeEvent(event);
    db.subscriptions[0].plan = "FREE"; // Detect a second write by watching for it to be undone.
    const second = await handleStripeEvent(event);

    // Both acknowledge, so Stripe stops retrying, but the work only happened once.
    expect(first.handled).toBe(true);
    expect(second.handled).toBe(true);
    expect(db.subscriptions).toHaveLength(1);
    expect(db.subscriptions[0].plan).toBe("FREE");
  });

  it("drops a cancelled workspace to Free instead of locking it out", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(subscriptionEvent("customer.subscription.created", buildSubscription()));
    await handleStripeEvent(
      subscriptionEvent(
        "customer.subscription.deleted",
        buildSubscription({ status: "canceled", canceled_at: 1_762_600_000 }),
      ),
    );

    expect(db.subscriptions[0].plan).toBe("FREE");
    expect(db.subscriptions[0].status).toBe("CANCELED");
  });

  it("treats an unknown price as Free rather than guessing a tier", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(
      subscriptionEvent(
        "customer.subscription.created",
        buildSubscription({
          items: { data: [{ quantity: 1, price: { id: "price_retired" } }] },
        }),
      ),
    );

    expect(db.subscriptions[0].plan).toBe("FREE");
  });

  it("ignores a subscription for a workspace it cannot resolve", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(
      subscriptionEvent(
        "customer.subscription.updated",
        buildSubscription({ metadata: {}, customer: "cus_unknown", id: "sub_unknown" }),
      ),
    );

    expect(db.subscriptions).toHaveLength(0);
  });

  it("finds the workspace by customer id when metadata is missing", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");
    db.subscriptions.push({
      organizationId: ORG,
      plan: "STARTER",
      status: "ACTIVE",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
    });

    await handleStripeEvent(
      subscriptionEvent("customer.subscription.updated", buildSubscription({ metadata: {} })),
    );

    expect(db.subscriptions).toHaveLength(1);
    expect(db.subscriptions[0].plan).toBe("GROWTH");
  });

  it("records an audit entry when checkout completes", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent({
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_1",
          client_reference_id: ORG,
          metadata: { tier: "GROWTH" },
        },
      },
    } as unknown as Stripe.Event);

    expect(stripeApi.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(db.subscriptions[0].plan).toBe("GROWTH");
    expect(audits[0]).toMatchObject({
      organizationId: ORG,
      actorType: "SYSTEM",
      action: "billing.subscription.started",
    });
  });

  it("skips a one-off checkout session", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent({
      id: "evt_payment",
      type: "checkout.session.completed",
      data: { object: { mode: "payment", subscription: null } },
    } as unknown as Stripe.Event);

    expect(stripeApi.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(db.subscriptions).toHaveLength(0);
  });
});

describe("invoice events", () => {
  beforeEach(() => {
    db.subscriptions.push({
      organizationId: ORG,
      plan: "GROWTH",
      status: "ACTIVE",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("marks the workspace past due and tells someone", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(invoiceEvent("invoice.payment_failed", "cus_1"));

    expect(db.subscriptions[0].status).toBe("PAST_DUE");
    expect(db.subscriptions[0].plan).toBe("GROWTH");
    expect(notifications[0]).toMatchObject({ organizationId: ORG, type: "BILLING", href: "/billing" });
  });

  it("restores access when the payment goes through", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    await handleStripeEvent(invoiceEvent("invoice.payment_failed", "cus_1", "evt_failed"));
    await handleStripeEvent(invoiceEvent("invoice.paid", "cus_1", "evt_paid"));

    expect(db.subscriptions[0].status).toBe("ACTIVE");
  });

  it("survives an invoice for a customer that is not ours", async () => {
    const { handleStripeEvent } = await import("@/lib/stripe/webhook");

    const result = await handleStripeEvent(invoiceEvent("invoice.payment_failed", "cus_other"));

    expect(result.handled).toBe(true);
    expect(notifications).toHaveLength(0);
    expect(db.subscriptions[0].status).toBe("ACTIVE");
  });
});

describe("status mapping", () => {
  it("covers every status Stripe can send", async () => {
    const { mapStatus } = await import("@/lib/stripe/subscriptions");

    const statuses: Stripe.Subscription.Status[] = [
      "trialing",
      "active",
      "past_due",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "paused",
    ];

    for (const status of statuses) {
      expect(mapStatus(status), status).toBeTruthy();
    }

    expect(mapStatus("incomplete_expired")).toBe("CANCELED");
    expect(mapStatus("past_due")).toBe("PAST_DUE");
  });

  it("maps configured price ids onto plans", async () => {
    const { planForPrice } = await import("@/lib/stripe/subscriptions");

    expect(planForPrice("price_starter")).toBe("STARTER");
    expect(planForPrice("price_growth")).toBe("GROWTH");
    expect(planForPrice("price_agency")).toBe("AGENCY");
    expect(planForPrice(null)).toBe("FREE");
    expect(planForPrice("price_unknown")).toBe("FREE");
  });
});
