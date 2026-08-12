/**
 * Google Ads returns money as int64 micros. We keep micros in the database (exact) and
 * convert to currency units exactly once, at the boundary where data leaves the server.
 */

export const MICROS_PER_UNIT = 1_000_000;

export function microsToUnits(micros: bigint | number | null | undefined): number {
  if (micros === null || micros === undefined) return 0;
  const value = typeof micros === "bigint" ? Number(micros) : micros;
  if (!Number.isFinite(value)) return 0;
  return value / MICROS_PER_UNIT;
}

export function unitsToMicros(units: number | null | undefined): bigint {
  if (units === null || units === undefined || !Number.isFinite(units)) return 0n;
  return BigInt(Math.round(units * MICROS_PER_UNIT));
}

export function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

/** Decimal columns arrive as Prisma Decimal objects; normalize them to plain numbers. */
export function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && "toString" in (value as object)) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
