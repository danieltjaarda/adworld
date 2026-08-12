import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * Entitlements.
 *
 * The plan a workspace pays for has to be enforced where the work happens, not in the
 * UI. These tests drive the real assertions against a Prisma stub so the "upgrade to
 * continue" boundaries are exercised for each tier.
 */

type State = {
  subscription: { plan: PlanTier; status: SubscriptionStatus } | null;
  accounts: number;
  members: number;
  invitations: number;
  usage: Record<string, number>;
};

const state: State = {
  subscription: null,
  accounts: 0,
  members: 1,
  invitations: 0,
  usage: {},
};

const upserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    subscription: {
      findUnique: async () => state.subscription,
    },
    googleAdsAccount: {
      count: async () => state.accounts,
    },
    organizationMember: {
      count: async () => state.members,
    },
    invitation: {
      count: async () => state.invitations,
    },
    usageCounter: {
      findUnique: async ({ where }: { where: { organizationId_period_metric: { metric: string } } }) => {
        const metric = where.organizationId_period_metric.metric;
        return metric in state.usage ? { value: state.usage[metric] } : null;
      },
      upsert: async (args: Record<string, unknown>) => {
        upserts.push(args);
        return null;
      },
    },
  },
}));

const ORG = "org_test";

function subscribe(plan: PlanTier, status: SubscriptionStatus = "ACTIVE") {
  state.subscription = { plan, status };
}

beforeEach(() => {
  state.subscription = null;
  state.accounts = 0;
  state.members = 1;
  state.invitations = 0;
  state.usage = {};
  upserts.length = 0;
});

describe("plan resolution", () => {
  it("treats a workspace with no subscription row as Free", async () => {
    const { getEntitlements } = await import("@/lib/billing/limits");
    const entitlements = await getEntitlements(ORG);

    expect(entitlements.plan).toBe("FREE");
    expect(entitlements.limits.automaticMode).toBe(false);
    expect(entitlements.writeEnabled).toBe(true);
  });

  it("keeps write access during a trial", async () => {
    const { getEntitlements } = await import("@/lib/billing/limits");
    subscribe("GROWTH", "TRIALING");

    const entitlements = await getEntitlements(ORG);
    expect(entitlements.writeEnabled).toBe(true);
    expect(entitlements.limits.accounts).toBe(5);
  });

  it("suspends writes while payment is failing but leaves the plan intact", async () => {
    const { assertWriteEnabled, getEntitlements } = await import("@/lib/billing/limits");
    subscribe("GROWTH", "PAST_DUE");

    const entitlements = await getEntitlements(ORG);
    expect(entitlements.plan).toBe("GROWTH");
    expect(entitlements.writeEnabled).toBe(false);

    await expect(assertWriteEnabled(ORG)).rejects.toThrow(/payment/i);
  });
});

describe("account limits", () => {
  it("stops a Starter workspace at its single account", async () => {
    const { assertCanAddAccount } = await import("@/lib/billing/limits");
    subscribe("STARTER");

    state.accounts = 0;
    await expect(assertCanAddAccount(ORG)).resolves.toBeUndefined();

    state.accounts = 1;
    await expect(assertCanAddAccount(ORG)).rejects.toThrow(/Starter plan includes 1 Google Ads account/);
  });

  it("lets Growth connect up to five", async () => {
    const { assertCanAddAccount } = await import("@/lib/billing/limits");
    subscribe("GROWTH");

    state.accounts = 4;
    await expect(assertCanAddAccount(ORG)).resolves.toBeUndefined();

    state.accounts = 5;
    await expect(assertCanAddAccount(ORG)).rejects.toThrow(/5 Google Ads accounts/);
  });

  it("never blocks an Agency workspace", async () => {
    const { assertCanAddAccount } = await import("@/lib/billing/limits");
    subscribe("AGENCY");
    state.accounts = 250;

    await expect(assertCanAddAccount(ORG)).resolves.toBeUndefined();
  });
});

describe("team limits", () => {
  it("counts pending invitations against the seat count", async () => {
    const { assertCanInviteMember } = await import("@/lib/billing/limits");
    subscribe("STARTER"); // 3 seats

    state.members = 2;
    state.invitations = 0;
    await expect(assertCanInviteMember(ORG)).resolves.toBeUndefined();

    // Two members plus one outstanding invite already fills the plan.
    state.invitations = 1;
    await expect(assertCanInviteMember(ORG)).rejects.toThrow(/3 team members/);
  });
});

describe("automatic mode", () => {
  it("is reserved for Growth and Agency", async () => {
    const { assertAutomaticModeAllowed } = await import("@/lib/billing/limits");

    subscribe("FREE");
    await expect(assertAutomaticModeAllowed(ORG)).rejects.toThrow(/Automatic optimization/);

    subscribe("STARTER");
    await expect(assertAutomaticModeAllowed(ORG)).rejects.toThrow(/Automatic optimization/);

    subscribe("GROWTH");
    await expect(assertAutomaticModeAllowed(ORG)).resolves.toBeUndefined();

    subscribe("AGENCY");
    await expect(assertAutomaticModeAllowed(ORG)).resolves.toBeUndefined();
  });
});

describe("metered usage", () => {
  it("lets a Free workspace read and chat but not apply changes", async () => {
    const { assertWithinUsage } = await import("@/lib/billing/limits");
    subscribe("FREE");

    await expect(assertWithinUsage(ORG, "chat_messages")).resolves.toBeUndefined();
    await expect(assertWithinUsage(ORG, "ai_actions")).rejects.toThrow(/paid plan/);
  });

  it("blocks once the monthly allowance is spent", async () => {
    const { assertWithinUsage } = await import("@/lib/billing/limits");
    subscribe("STARTER"); // 200 AI actions

    state.usage.ai_actions = 199;
    await expect(assertWithinUsage(ORG, "ai_actions")).resolves.toBeUndefined();

    state.usage.ai_actions = 200;
    await expect(assertWithinUsage(ORG, "ai_actions")).rejects.toThrow(/all 200 AI changes/);
  });

  it("does not meter an unlimited plan", async () => {
    const { assertWithinUsage } = await import("@/lib/billing/limits");
    subscribe("AGENCY");
    state.usage.ai_actions = 999_999;

    await expect(assertWithinUsage(ORG, "ai_actions")).resolves.toBeUndefined();
  });

  it("increments the counter for the current calendar month", async () => {
    const { currentPeriod, recordUsage } = await import("@/lib/billing/limits");
    await recordUsage(ORG, "ai_actions");

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      where: {
        organizationId_period_metric: {
          organizationId: ORG,
          period: currentPeriod(),
          metric: "ai_actions",
        },
      },
      update: { value: { increment: 1 } },
    });
  });

  it("formats the period so months sort lexically", async () => {
    const { currentPeriod } = await import("@/lib/billing/limits");

    expect(currentPeriod(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
    expect(currentPeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(currentPeriod(new Date("2026-02-01T00:30:00Z")) > currentPeriod(new Date("2026-01-31T23:30:00Z"))).toBe(
      true,
    );
  });
});

describe("plan catalogue", () => {
  it("orders tiers so an upgrade is distinguishable from a downgrade", async () => {
    const { isUpgrade } = await import("@/lib/billing/plans");

    expect(isUpgrade("FREE", "GROWTH")).toBe(true);
    expect(isUpgrade("GROWTH", "STARTER")).toBe(false);
    expect(isUpgrade("AGENCY", "AGENCY")).toBe(false);
  });

  it("never lets a higher tier allow less than a lower one", async () => {
    const { PLAN_ORDER, limitsFor } = await import("@/lib/billing/plans");

    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      const lower = limitsFor(PLAN_ORDER[index - 1]);
      const higher = limitsFor(PLAN_ORDER[index]);

      for (const key of ["accounts", "teamMembers", "aiActionsPerMonth", "chatMessagesPerMonth"] as const) {
        const a = lower[key];
        const b = higher[key];
        if (a === null) expect(b, `${PLAN_ORDER[index]}.${key}`).toBeNull();
        else if (b !== null) expect(b, `${PLAN_ORDER[index]}.${key}`).toBeGreaterThanOrEqual(a);
      }

      expect(higher.historyDays).toBeGreaterThanOrEqual(lower.historyDays);
    }
  });
});
