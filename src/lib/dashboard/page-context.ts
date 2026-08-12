import "server-only";

import { redirect } from "next/navigation";

import {
  getAuthContext,
  listAccounts,
  resolveActiveAccount,
  type AccountSummary,
  type AuthContext,
} from "@/lib/auth/context";
import { isDateKey, resolveRange, type DateRange, type RangePreset } from "@/lib/analytics/date-range";
import {
  getAccountSettings,
  profitConfigFrom,
  type AccountSettings,
  type Scope,
} from "@/lib/analytics/queries";
import type { ProfitConfig } from "@/lib/analytics/metrics";

/**
 * Everything a dashboard page needs, resolved once: who is asking, which account they
 * are looking at, and which period. Pages never parse this themselves, so scoping and
 * date handling cannot drift between them.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export type PageContext = {
  auth: AuthContext;
  account: AccountSummary;
  accounts: AccountSummary[];
  scope: Scope;
  settings: AccountSettings;
  profitConfig: ProfitConfig;
  range: DateRange;
  currency: string;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRangeFromParams(params: SearchParams, timeZone: string): DateRange {
  const requested = single(params.range) as RangePreset | undefined;
  const start = single(params.start);
  const end = single(params.end);

  if (requested === "custom" && start && end && isDateKey(start) && isDateKey(end)) {
    return resolveRange("custom", timeZone, { start, end });
  }

  const valid: RangePreset[] = [
    "today",
    "yesterday",
    "last_7",
    "last_14",
    "last_30",
    "last_90",
    "this_month",
    "last_month",
  ];

  return resolveRange(
    requested && valid.includes(requested) ? requested : "last_30",
    timeZone,
  );
}

/**
 * Loads the page context or redirects. Any page using this is automatically protected
 * and automatically tenant-scoped.
 */
export async function loadPageContext(searchParams: SearchParams = {}): Promise<PageContext> {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const accounts = await listAccounts(auth.organization.id);
  if (accounts.length === 0) redirect("/onboarding");

  const account = await resolveActiveAccount(auth);
  if (!account) redirect("/onboarding");

  const scope = { organizationId: auth.organization.id, accountId: account.id };
  const settings = await getAccountSettings(scope);

  return {
    auth,
    account,
    accounts,
    scope,
    settings,
    profitConfig: profitConfigFrom(settings),
    range: resolveRangeFromParams(searchParams, account.timeZone),
    currency: account.currencyCode,
  };
}

/** Builds a URL that keeps the current filters and changes only what is passed. */
export function withParams(
  pathname: string,
  current: SearchParams,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    const resolved = single(value);
    if (resolved) params.set(key, resolved);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export type SortState = { key: string; direction: "asc" | "desc" };

export function resolveSort(
  params: SearchParams,
  allowed: readonly string[],
  fallback: SortState,
): SortState {
  const key = single(params.sort);
  const direction = single(params.dir);
  return {
    key: key && allowed.includes(key) ? key : fallback.key,
    direction: direction === "asc" ? "asc" : direction === "desc" ? "desc" : fallback.direction,
  };
}

/** Sorts rows by a numeric or string accessor, nulls last regardless of direction. */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  accessors: Record<string, (row: T) => number | string | null>,
): T[] {
  const accessor = accessors[sort.key];
  if (!accessor) return rows;

  const factor = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = accessor(a);
    const right = accessor(b);

    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right)) * factor;
    }
    return (left - right) * factor;
  });
}
