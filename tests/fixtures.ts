import { DEFAULT_SETTINGS, type AccountSettings } from "@/lib/analytics/queries";

/** Settings shared by the tests, starting from the product defaults. */
export function settingsFixture(overrides: Partial<AccountSettings> = {}): AccountSettings {
  return {
    ...DEFAULT_SETTINGS,
    mode: "AUTOMATIC",
    targetRoas: 4,
    maxDailyBudget: 200,
    maxDailyBudgetIncreasePct: 20,
    maxDailyBudgetDecreasePct: 20,
    maxBidChangePct: 20,
    maxActionsPerRun: 10,
    minConfidence: 0.7,
    autoNegativeKeywords: true,
    autoBidChanges: true,
    autoBudgetChanges: true,
    ...overrides,
  };
}
