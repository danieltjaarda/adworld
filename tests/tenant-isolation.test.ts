import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant isolation.
 *
 * The product's central promise is that one customer can never see another's Google Ads
 * data. Rather than trusting review, these tests call the real query functions against a
 * recording Prisma stub and assert that every single database read carries the
 * organization id — including nested relation filters.
 */

type Call = { model: string; method: string; args: Record<string, unknown> };

const calls: Call[] = [];

/**
 * A Prisma stand-in that records what it was asked for. Aggregates return shapes the
 * query layer can safely map over.
 */
function makeModel(model: string) {
  const record = (method: string) => (args: Record<string, unknown> = {}) => {
    calls.push({ model, method, args });

    if (method === "aggregate") {
      return Promise.resolve({
        _sum: {
          impressions: 0n,
          clicks: 0n,
          costMicros: 0n,
          conversions: 0,
          conversionValueMicros: 0n,
          allConversions: 0,
          allConversionValueMicros: 0n,
        },
      });
    }
    if (method === "groupBy" || method === "findMany") return Promise.resolve([]);
    if (method === "count") return Promise.resolve(0);
    return Promise.resolve(null);
  };

  return {
    findFirst: record("findFirst"),
    findUnique: record("findUnique"),
    findMany: record("findMany"),
    aggregate: record("aggregate"),
    groupBy: record("groupBy"),
    count: record("count"),
  };
}

vi.mock("@/lib/db/prisma", () => {
  // A proxy so any model the query layer reaches for is recorded, including ones added later.
  const cache = new Map<string, ReturnType<typeof makeModel>>();
  const prisma = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (!cache.has(property)) cache.set(property, makeModel(property));
        return cache.get(property);
      },
    },
  );

  return { prisma };
});

const ORGANIZATION_A = "11111111-1111-1111-1111-111111111111";
const ACCOUNT_A = "22222222-2222-2222-2222-222222222222";

const scope = { organizationId: ORGANIZATION_A, accountId: ACCOUNT_A };
const range = { start: "2026-07-01", end: "2026-07-31" };
const profitConfig = { grossMarginPct: null, fixedCostPerOrder: null, leadValue: null };

/** Walks a `where` clause and reports whether the organization id appears anywhere. */
function mentionsOrganization(value: unknown): boolean {
  if (value === null || typeof value !== "object") return value === ORGANIZATION_A;

  if (Array.isArray(value)) return value.some(mentionsOrganization);

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (key === "organizationId" && child === ORGANIZATION_A) return true;
    return mentionsOrganization(child);
  });
}

beforeEach(() => {
  calls.length = 0;
});

describe("analytics queries", () => {
  it("scope every read to the organization", async () => {
    const queries = await import("@/lib/analytics/queries");

    await queries.getAccountSettings(scope);
    await queries.getTotals(scope, range);
    await queries.getTimeSeries(scope, range, profitConfig);
    await queries.getCampaignPerformance(scope, range, profitConfig);
    await queries.getKeywordPerformance(scope, range, profitConfig);
    await queries.getSearchTermPerformance(scope, profitConfig);
    await queries.getAdPerformance(scope, range, profitConfig);
    await queries.getSegmentPerformance(scope, range, "DEVICE", profitConfig);
    await queries.getConversionPerformance(scope);

    expect(calls.length).toBeGreaterThan(8);

    const unscoped = calls.filter((call) => !mentionsOrganization(call.args.where));
    expect(
      unscoped.map((call) => `${call.model}.${call.method}`),
      "every analytics query must filter by organizationId",
    ).toEqual([]);
  });

  it("also constrain the account, so one tenant's accounts stay separate from each other", async () => {
    const queries = await import("@/lib/analytics/queries");
    await queries.getCampaignPerformance(scope, range, profitConfig);

    const scoped = calls.filter((call) => JSON.stringify(call.args.where ?? {}).includes(ACCOUNT_A));
    expect(scoped.length).toBe(calls.length);
  });
});

describe("agent tools", () => {
  it("never read outside the scope they are given", async () => {
    const tools = await import("@/lib/ai/tools");

    const context = {
      organizationId: ORGANIZATION_A,
      accountId: ACCOUNT_A,
      currency: "EUR",
      timeZone: "Europe/Amsterdam",
    };

    // Only tools with required arguments need anything here.
    const argumentsByTool: Record<string, string> = {
      getSegmentPerformance: JSON.stringify({ segment: "DEVICE" }),
    };

    for (const name of tools.toolNames()) {
      calls.length = 0;
      const execution = await tools.executeTool(context, name, argumentsByTool[name] ?? "{}");
      expect(execution.ok, `${name} should run with default arguments`).toBe(true);

      const unscoped = calls.filter((call) => !mentionsOrganization(call.args.where));
      expect(unscoped.map((call) => `${name}: ${call.model}.${call.method}`)).toEqual([]);
    }
  });

  it("rejects a tool name the model invented", async () => {
    const tools = await import("@/lib/ai/tools");

    const execution = await tools.executeTool(
      { organizationId: ORGANIZATION_A, accountId: ACCOUNT_A, currency: "EUR", timeZone: "UTC" },
      "deleteEverything",
      "{}",
    );

    expect(execution.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
