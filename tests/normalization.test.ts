import { describe, expect, it } from "vitest";

import {
  daysBetween,
  enumerateDays,
  isDateKey,
  previousRange,
  rangeLength,
  resolveRange,
  shiftDays,
  todayInTimeZone,
} from "@/lib/analytics/date-range";
import { toEntityStatus } from "@/lib/google-ads/campaigns";
import { mapGoogleAdsError, normalizeCustomerId } from "@/lib/google-ads/client";
import { searchTermKeyFor, resolveWindow } from "@/lib/sync/account-sync";

/**
 * Normalization: what arrives from Google is stringly-typed, timezone-sensitive and
 * occasionally absent. These tests cover the translation into the local model.
 */

describe("customer ids", () => {
  it("strips the formatting Google shows in its UI", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizeCustomerId("customers/1234567890")).toBe("1234567890");
    expect(normalizeCustomerId("1234567890")).toBe("1234567890");
  });
});

describe("entity status", () => {
  it("maps the known values and never throws on an unknown one", () => {
    expect(toEntityStatus("ENABLED")).toBe("ENABLED");
    expect(toEntityStatus("paused")).toBe("PAUSED");
    expect(toEntityStatus("REMOVED")).toBe("REMOVED");
    expect(toEntityStatus("SOMETHING_NEW")).toBe("UNKNOWN");
    expect(toEntityStatus(undefined)).toBe("UNKNOWN");
  });
});

describe("search term keys", () => {
  it("is stable across casing and whitespace so a term is not duplicated", () => {
    expect(searchTermKeyFor("123", " Wedding Videographer ")).toBe(
      searchTermKeyFor("123", "wedding videographer"),
    );
  });

  it("keeps the same query in different ad groups apart", () => {
    expect(searchTermKeyFor("123", "shoes")).not.toBe(searchTermKeyFor("456", "shoes"));
  });
});

describe("date keys", () => {
  it("validates the format", () => {
    expect(isDateKey("2026-08-11")).toBe(true);
    expect(isDateKey("11-08-2026")).toBe(false);
    expect(isDateKey("not a date")).toBe(false);
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("counts inclusive range lengths", () => {
    expect(daysBetween("2026-08-01", "2026-08-08")).toBe(7);
    expect(rangeLength({ start: "2026-08-01", end: "2026-08-07" })).toBe(7);
    expect(enumerateDays({ start: "2026-08-01", end: "2026-08-03" })).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });
});

describe("range presets", () => {
  it("produces a 7-day window that excludes today", () => {
    const range = resolveRange("last_7", "Europe/Amsterdam");
    const today = todayInTimeZone("Europe/Amsterdam");

    expect(rangeLength(range)).toBe(7);
    expect(range.end).toBe(shiftDays(today, -1));
  });

  it("compares against the immediately preceding window of equal length", () => {
    const previous = previousRange({ start: "2026-08-01", end: "2026-08-07" });

    expect(previous).toEqual({ start: "2026-07-25", end: "2026-07-31" });
    expect(rangeLength(previous)).toBe(7);
  });

  it("uses the account's timezone, not the server's", () => {
    const auckland = resolveRange("today", "Pacific/Auckland");
    const honolulu = resolveRange("today", "Pacific/Honolulu");

    // The two zones are never on the same calendar date.
    expect(auckland.start).not.toBe(honolulu.start);
  });

  it("falls back to a sane window for a custom range with missing dates", () => {
    const range = resolveRange("custom", "UTC", { start: null, end: null });
    expect(rangeLength(range)).toBeGreaterThan(0);
  });
});

describe("sync windows", () => {
  it("includes today and covers exactly the requested number of days", () => {
    const window = resolveWindow("UTC", 14);

    expect(window.end).toBe(todayInTimeZone("UTC"));
    expect(rangeLength(window)).toBe(14);
  });
});

describe("Google Ads error mapping", () => {
  it("turns an auth failure into a reconnect instruction", () => {
    const error = mapGoogleAdsError(401, { error: { message: "invalid credentials" } });

    expect(error.code).toBe("GOOGLE_AUTH");
    expect(error.userMessage).toContain("Reconnect");
  });

  it("explains a permission problem in terms the user can act on", () => {
    const error = mapGoogleAdsError(403, {
      error: {
        details: [
          { errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] },
        ],
      },
    });

    expect(error.userMessage).toContain("does not have access");
  });

  it("treats rate limiting as temporary", () => {
    const error = mapGoogleAdsError(429, {});
    expect(error.userMessage).toContain("rate limiting");
  });

  it("never leaks the raw Google message to the user", () => {
    const error = mapGoogleAdsError(400, {
      error: { message: "Request contains an invalid argument: internal detail" },
    });

    expect(error.userMessage).not.toContain("internal detail");
    expect(error.message).toContain("internal detail");
  });
});
