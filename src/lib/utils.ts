import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function initialsFrom(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Safe division used all over the analytics layer: no NaN, no Infinity. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function sum<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

export function groupBy<T, K extends string>(
  items: readonly T[],
  selector: (item: T) => K,
): Record<K, T[]> {
  const output = {} as Record<K, T[]>;
  for (const item of items) {
    const key = selector(item);
    (output[key] ??= []).push(item);
  }
  return output;
}

export function uniqueBy<T, K>(items: readonly T[], selector: (item: T) => K): T[] {
  const seen = new Set<K>();
  const output: T[] = [];
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
