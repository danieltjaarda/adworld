/**
 * Date handling for reporting.
 *
 * Google Ads reports in the *account's* time zone, so "today" is resolved with the
 * account time zone rather than the server's. Internally every date is a plain
 * YYYY-MM-DD key to keep comparisons free of DST and offset bugs.
 */

export type DateKey = string;

export type DateRange = {
  start: DateKey;
  end: DateKey;
  label: string;
  preset: RangePreset;
};

export type RangePreset =
  | "today"
  | "yesterday"
  | "last_7"
  | "last_14"
  | "last_30"
  | "last_90"
  | "this_month"
  | "last_month"
  | "custom";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string; shortLabel: string }> = [
  { value: "today", label: "Today", shortLabel: "1D" },
  { value: "yesterday", label: "Yesterday", shortLabel: "1D" },
  { value: "last_7", label: "Last 7 days", shortLabel: "7D" },
  { value: "last_30", label: "Last 30 days", shortLabel: "30D" },
  { value: "last_90", label: "Last 90 days", shortLabel: "90D" },
  { value: "this_month", label: "This month", shortLabel: "MTD" },
  { value: "last_month", label: "Last month", shortLabel: "LM" },
];

export function toDateKey(date: Date): DateKey {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: DateKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDateKey(value).getTime());
}

export function shiftDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

export function daysBetween(start: DateKey, end: DateKey): number {
  const ms = parseDateKey(end).getTime() - parseDateKey(start).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive day count — a range of a single day has length 1. */
export function rangeLength(range: { start: DateKey; end: DateKey }): number {
  return daysBetween(range.start, range.end) + 1;
}

export function todayInTimeZone(timeZone: string): DateKey {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return toDateKey(new Date());
  }
}

export function enumerateDays(range: { start: DateKey; end: DateKey }): DateKey[] {
  const days: DateKey[] = [];
  let cursor = range.start;
  let guard = 0;
  while (cursor <= range.end && guard < 1000) {
    days.push(cursor);
    cursor = shiftDays(cursor, 1);
    guard += 1;
  }
  return days;
}

export function resolveRange(
  preset: RangePreset,
  timeZone: string,
  custom?: { start?: string | null; end?: string | null },
): DateRange {
  const today = todayInTimeZone(timeZone);
  const yesterday = shiftDays(today, -1);

  switch (preset) {
    case "today":
      return { start: today, end: today, label: "Today", preset };
    case "yesterday":
      return { start: yesterday, end: yesterday, label: "Yesterday", preset };
    case "last_14":
      return { start: shiftDays(yesterday, -13), end: yesterday, label: "Last 14 days", preset };
    case "last_30":
      return { start: shiftDays(yesterday, -29), end: yesterday, label: "Last 30 days", preset };
    case "last_90":
      return { start: shiftDays(yesterday, -89), end: yesterday, label: "Last 90 days", preset };
    case "this_month": {
      const start = `${today.slice(0, 7)}-01`;
      return { start, end: today, label: "This month", preset };
    }
    case "last_month": {
      const firstOfThisMonth = parseDateKey(`${today.slice(0, 7)}-01`);
      const endPrev = shiftDays(toDateKey(firstOfThisMonth), -1);
      const startPrev = `${endPrev.slice(0, 7)}-01`;
      return { start: startPrev, end: endPrev, label: "Last month", preset };
    }
    case "custom": {
      const start = custom?.start && isDateKey(custom.start) ? custom.start : shiftDays(yesterday, -29);
      const end = custom?.end && isDateKey(custom.end) ? custom.end : yesterday;
      const ordered = start <= end ? { start, end } : { start: end, end: start };
      return { ...ordered, label: "Custom range", preset: "custom" };
    }
    case "last_7":
    default:
      return { start: shiftDays(yesterday, -6), end: yesterday, label: "Last 7 days", preset: "last_7" };
  }
}

/** The equally long window ending the day before `range` starts. */
export function previousRange(range: { start: DateKey; end: DateKey }): {
  start: DateKey;
  end: DateKey;
} {
  const length = rangeLength(range);
  const end = shiftDays(range.start, -1);
  const start = shiftDays(end, -(length - 1));
  return { start, end };
}

/** Same length window one year earlier, for seasonality checks. */
export function yearOverYearRange(range: { start: DateKey; end: DateKey }): {
  start: DateKey;
  end: DateKey;
} {
  return { start: shiftDays(range.start, -365), end: shiftDays(range.end, -365) };
}

export function rangeToDates(range: { start: DateKey; end: DateKey }): { gte: Date; lte: Date } {
  return { gte: parseDateKey(range.start), lte: parseDateKey(range.end) };
}

export function formatRangeLabel(range: { start: DateKey; end: DateKey }): string {
  const format = (key: DateKey) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(parseDateKey(key));
  if (range.start === range.end) return format(range.start);
  return `${format(range.start)} – ${format(range.end)}`;
}

export function parseRangePreset(value: string | null | undefined): RangePreset {
  const allowed: RangePreset[] = [
    "today",
    "yesterday",
    "last_7",
    "last_14",
    "last_30",
    "last_90",
    "this_month",
    "last_month",
    "custom",
  ];
  return allowed.includes(value as RangePreset) ? (value as RangePreset) : "last_30";
}
