/**
 * Presentation helpers. Locale is pinned so server and client render identical strings
 * (a mismatched locale is a classic hydration bug).
 */

const LOCALE = "en-US";

const currencyCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let formatter = currencyCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    currencyCache.set(key, formatter);
  }
  return formatter;
}

export function formatCurrency(
  value: number | null | undefined,
  currency = "EUR",
  options: { decimals?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";

  if (options.compact && Math.abs(value) >= 10_000) {
    const formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: currency || "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return formatter.format(value);
  }

  const decimals =
    options.decimals ?? (Math.abs(value) >= 1000 || Number.isInteger(value) ? 0 : 2);
  return currencyFormatter(currency, decimals).format(value);
}

/** Bare symbol for input affixes, where a formatted amount would be noise. */
export function currencySymbol(currency: string): string {
  const parts = currencyFormatter(currency, 0).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

export function formatNumber(
  value: number | null | undefined,
  options: { decimals?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: options.decimals ?? 0,
    minimumFractionDigits: options.decimals ?? 0,
    notation: options.compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

export function formatDecimal(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : decimals,
    minimumFractionDigits: 0,
  }).format(value);
}

/** Input is a ratio (0.184), output is "18.4%". */
export function formatPercent(
  value: number | null | undefined,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const decimals = options.decimals ?? (Math.abs(value) < 0.1 ? 2 : 1);
  const formatted = new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(value);
  return formatted;
}

export function formatRatio(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}x`;
}

export function formatMetric(
  value: number | null | undefined,
  format: "currency" | "number" | "percent" | "ratio" | "decimal",
  currency = "EUR",
): string {
  switch (format) {
    case "currency":
      return formatCurrency(value, currency);
    case "percent":
      return formatPercent(value);
    case "ratio":
      return formatRatio(value);
    case "decimal":
      return formatDecimal(value, 1);
    case "number":
    default:
      return formatNumber(value);
  }
}

export function formatDelta(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "—";
  return formatPercent(percent, { signed: true, decimals: 1 });
}

export function formatDate(value: Date | string, options: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Never";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

/** Google customer ids are 10 digits: 1234567890 → 123-456-7890. */
export function formatCustomerId(customerId: string): string {
  const digits = customerId.replace(/\D/g, "");
  if (digits.length !== 10) return customerId;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatCompactDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
