import { describe, expect, it } from "vitest";

import {
  assessDataSufficiency,
  computeDelta,
  computeProfit,
  derive,
  safePercentChange,
  sumRaw,
  weightedImpressionShare,
} from "@/lib/analytics/metrics";
import { microsToUnits, unitsToMicros } from "@/lib/analytics/money";

/**
 * Derived metrics are the numbers the whole product argues about, so the arithmetic is
 * pinned down here — including the awkward cases where a denominator is zero.
 */

const raw = {
  impressions: 10_000,
  clicks: 500,
  costMicros: 250_000_000, // 250.00
  conversions: 25,
  conversionValueMicros: 1_500_000_000, // 1500.00
  allConversions: 30,
  allConversionValueMicros: 1_600_000_000,
};

describe("money conversion", () => {
  it("round-trips units through micros without drift", () => {
    expect(microsToUnits(unitsToMicros(12.34))).toBe(12.34);
    expect(microsToUnits(unitsToMicros(0.01))).toBe(0.01);
    expect(unitsToMicros(1)).toBe(1_000_000n);
  });
});

describe("derive", () => {
  const metrics = derive(raw);

  it("computes the standard ratios", () => {
    expect(metrics.cost).toBe(250);
    expect(metrics.conversionValue).toBe(1500);
    expect(metrics.ctr).toBeCloseTo(0.05, 10);
    expect(metrics.cpc).toBeCloseTo(0.5, 10);
    expect(metrics.cpa).toBeCloseTo(10, 10);
    expect(metrics.roas).toBeCloseTo(6, 10);
    expect(metrics.conversionRate).toBeCloseTo(0.05, 10);
  });

  it("returns null instead of Infinity when a denominator is zero", () => {
    const empty = derive({
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
      conversionValueMicros: 0,
      allConversions: 0,
      allConversionValueMicros: 0,
    });

    expect(empty.ctr).toBeNull();
    expect(empty.cpc).toBeNull();
    expect(empty.cpa).toBeNull();
    expect(empty.roas).toBeNull();
  });

  it("sums rows before deriving, never averages the ratios", () => {
    const total = sumRaw([raw, raw]);
    const metrics2 = derive(total);

    expect(metrics2.cost).toBe(500);
    expect(metrics2.roas).toBeCloseTo(6, 10);
  });
});

describe("weightedImpressionShare", () => {
  it("weights by impressions rather than taking a plain average", () => {
    const share = weightedImpressionShare([
      { impressions: 9000, share: 0.9 },
      { impressions: 1000, share: 0.1 },
    ]);

    expect(share).toBeCloseTo(0.82, 10);
  });

  it("returns null when nothing usable was reported", () => {
    expect(weightedImpressionShare([{ impressions: 100, share: null }])).toBeNull();
  });
});

describe("computeProfit", () => {
  const metrics = derive(raw);

  it("treats revenue as profit when no margin is configured", () => {
    const profit = computeProfit(metrics, {
      grossMarginPct: null,
      fixedCostPerOrder: null,
      leadValue: null,
    });

    expect(profit.netProfit).toBe(1250);
  });

  it("applies the gross margin and per-order costs", () => {
    const profit = computeProfit(metrics, {
      grossMarginPct: 40,
      fixedCostPerOrder: 5,
      leadValue: null,
    });

    // 1500 * 40% = 600 gross, minus 250 spend, minus 25 * 5 fixed costs.
    expect(profit.grossProfit).toBe(600);
    expect(profit.netProfit).toBe(225);
    expect(profit.profitPerConversion).toBeCloseTo(9, 10);
  });

  it("shows that a high ROAS can still lose money on a thin margin", () => {
    const profit = computeProfit(metrics, {
      grossMarginPct: 10,
      fixedCostPerOrder: null,
      leadValue: null,
    });

    expect(metrics.roas).toBeCloseTo(6, 10);
    expect(profit.netProfit).toBeLessThan(0);
  });

  it("falls back to a lead value when conversions carry no revenue", () => {
    const leadGen = derive({ ...raw, conversionValueMicros: 0 });
    const profit = computeProfit(leadGen, {
      grossMarginPct: null,
      fixedCostPerOrder: null,
      leadValue: 40,
    });

    expect(profit.usesLeadValue).toBe(true);
    expect(profit.revenue).toBe(1000);
    expect(profit.netProfit).toBe(750);
  });
});

describe("computeDelta", () => {
  it("reads a falling CPA as an improvement", () => {
    const delta = computeDelta(8, 10, "lower-is-better");

    expect(delta.percent).toBeCloseTo(-0.2, 10);
    expect(delta.sentiment).toBe("positive");
  });

  it("reads a falling ROAS as a regression", () => {
    expect(computeDelta(4, 6, "higher-is-better").sentiment).toBe("negative");
  });

  it("has no opinion about spend on its own", () => {
    expect(computeDelta(200, 100, "neutral").sentiment).toBe("neutral");
  });

  it("returns null rather than infinity when there is no baseline", () => {
    expect(computeDelta(10, 0, "higher-is-better").percent).toBeNull();
    expect(safePercentChange(10, 0)).toBeNull();
    expect(safePercentChange(null, 10)).toBeNull();
  });

  it("expresses percent change in whole percent", () => {
    expect(safePercentChange(37, 100)).toBeCloseTo(-63, 10);
  });
});

describe("assessDataSufficiency", () => {
  const thresholds = { minClicks: 30, minImpressions: 500, minSpend: 50 };

  it("blocks a decision on two clicks", () => {
    const verdict = assessDataSufficiency(
      {
        impressions: 40,
        clicks: 2,
        costMicros: 4_000_000,
        conversions: 0,
        conversionValueMicros: 0,
        allConversions: 0,
        allConversionValueMicros: 0,
      },
      thresholds,
    );

    expect(verdict.sufficient).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("clicks");
  });

  it("allows a decision once every threshold is met", () => {
    expect(assessDataSufficiency(raw, thresholds).sufficient).toBe(true);
  });
});
