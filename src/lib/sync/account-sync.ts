import "server-only";

import type { EntityStatus, MatchType, SearchTermStatus } from "@/generated/prisma/enums";
import { parseDateKey, shiftDays, toDateKey, todayInTimeZone } from "@/lib/analytics/date-range";
import { prisma } from "@/lib/db/prisma";
import { AppError, isAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { createProvider, type AccountSnapshot } from "@/lib/google-ads/provider";
import { getConnectionAccessToken } from "@/lib/google-ads/tokens";
import type { DateWindow } from "@/lib/google-ads/types";
import { bulkUpsertDailyMetrics, bulkUpsertSegments, mapWithConcurrency } from "@/lib/sync/bulk";

/**
 * Google Ads → local warehouse.
 *
 * The sync is idempotent: every write is an upsert keyed on the Google-side id, so
 * re-running it (a cron retry, a manual refresh) converges to the same state instead of
 * duplicating rows. Entities that disappear from a full sync are marked REMOVED rather
 * than deleted, which keeps historical metrics attached to something.
 */

const log = createLogger("sync.account");

export const DEFAULT_LOOKBACK_DAYS = 90;
export const INCREMENTAL_LOOKBACK_DAYS = 14;

export type SyncOptions = {
  lookbackDays?: number;
  /** Full syncs also reconcile removed entities. */
  full?: boolean;
};

export type SyncResult = {
  accountId: string;
  window: DateWindow;
  mode: "live" | "demo";
  counts: {
    campaigns: number;
    adGroups: number;
    keywords: number;
    ads: number;
    searchTerms: number;
    conversions: number;
    dailyMetrics: number;
    segments: number;
  };
  durationMs: number;
};

function toMatchType(value: string): MatchType {
  return value === "EXACT" || value === "PHRASE" || value === "BROAD" ? value : "UNKNOWN";
}

function toEntityStatus(value: string): EntityStatus {
  return value === "ENABLED" || value === "PAUSED" || value === "REMOVED" ? value : "UNKNOWN";
}

function toSearchTermStatus(value: string): SearchTermStatus {
  return value === "ADDED" || value === "EXCLUDED" || value === "ADDED_EXCLUDED" || value === "NONE"
    ? value
    : "UNKNOWN";
}

export function searchTermKeyFor(adGroupId: string | null, text: string): string {
  return `${adGroupId ?? "none"}:${text.trim().toLowerCase()}`;
}

export function resolveWindow(timeZone: string, lookbackDays: number): DateWindow {
  const today = todayInTimeZone(timeZone);
  return { start: shiftDays(today, -(lookbackDays - 1)), end: today };
}

/**
 * Syncs one account. `organizationId` is required and every write is scoped by it, so a
 * mis-routed account id cannot write into another tenant's data.
 */
export async function syncAccount(
  organizationId: string,
  accountId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const startedAt = Date.now();

  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId },
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      isDemo: true,
      loginCustomerId: true,
      connectionId: true,
      timeZone: true,
    },
  });

  if (!account) throw new AppError("NOT_FOUND", "That Google Ads account is not available.");

  await prisma.googleAdsAccount.update({
    where: { id: account.id },
    data: { syncStatus: "SYNCING", syncError: null },
  });

  try {
    const credentials =
      account.isDemo || !account.connectionId
        ? null
        : await getConnectionAccessToken(organizationId, account.connectionId);

    const provider = createProvider(account, credentials);
    const window = resolveWindow(account.timeZone, options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    const snapshot = await provider.fetchSnapshot(window);

    const counts = await persistSnapshot(organizationId, account.id, snapshot, {
      full: options.full ?? true,
    });

    await prisma.googleAdsAccount.update({
      where: { id: account.id },
      data: { syncStatus: "SYNCED", lastSyncedAt: new Date(), syncError: null },
    });

    const durationMs = Date.now() - startedAt;
    log.info("account synced", { accountId: account.id, mode: provider.mode, durationMs, ...counts });

    return { accountId: account.id, window, mode: provider.mode, counts, durationMs };
  } catch (error) {
    const message = isAppError(error)
      ? error.userMessage
      : error instanceof Error
        ? error.message
        : "Unknown sync failure";

    await prisma.googleAdsAccount.update({
      where: { id: account.id },
      data: { syncStatus: "ERROR", syncError: message.slice(0, 500) },
    });

    log.error("account sync failed", { accountId: account.id, error });
    throw error;
  }
}

async function persistSnapshot(
  organizationId: string,
  accountId: string,
  snapshot: AccountSnapshot,
  options: { full: boolean },
): Promise<SyncResult["counts"]> {
  // ---- campaigns ----------------------------------------------------------
  const campaignRowIds = new Map<string, string>();

  await mapWithConcurrency(snapshot.campaigns, 8, async (campaign) => {
    const row = await prisma.campaign.upsert({
      where: { accountId_campaignId: { accountId, campaignId: campaign.campaignId } },
      create: {
        organizationId,
        accountId,
        campaignId: campaign.campaignId,
        name: campaign.name,
        status: toEntityStatus(campaign.status),
        advertisingChannel: campaign.advertisingChannel,
        biddingStrategyType: campaign.biddingStrategyType,
        budgetId: campaign.budgetId,
        budgetName: campaign.budgetName,
        budgetAmountMicros: BigInt(Math.round(campaign.budgetAmountMicros)),
        budgetIsShared: campaign.budgetIsShared,
        budgetDeliveryMethod: campaign.budgetDeliveryMethod,
        targetRoas: campaign.targetRoas,
        targetCpaMicros: campaign.targetCpaMicros ? BigInt(Math.round(campaign.targetCpaMicros)) : null,
        startDate: campaign.startDate ? parseDateKey(campaign.startDate) : null,
        endDate: campaign.endDate ? parseDateKey(campaign.endDate) : null,
        optimizationScore: campaign.optimizationScore,
        lastSyncedAt: new Date(),
      },
      update: {
        name: campaign.name,
        status: toEntityStatus(campaign.status),
        advertisingChannel: campaign.advertisingChannel,
        biddingStrategyType: campaign.biddingStrategyType,
        budgetId: campaign.budgetId,
        budgetName: campaign.budgetName,
        budgetAmountMicros: BigInt(Math.round(campaign.budgetAmountMicros)),
        budgetIsShared: campaign.budgetIsShared,
        budgetDeliveryMethod: campaign.budgetDeliveryMethod,
        targetRoas: campaign.targetRoas,
        targetCpaMicros: campaign.targetCpaMicros ? BigInt(Math.round(campaign.targetCpaMicros)) : null,
        startDate: campaign.startDate ? parseDateKey(campaign.startDate) : null,
        endDate: campaign.endDate ? parseDateKey(campaign.endDate) : null,
        optimizationScore: campaign.optimizationScore,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    campaignRowIds.set(campaign.campaignId, row.id);
  });

  // ---- ad groups ----------------------------------------------------------
  const adGroupRowIds = new Map<string, string>();

  await mapWithConcurrency(snapshot.adGroups, 8, async (adGroup) => {
    const campaignRowId = campaignRowIds.get(adGroup.campaignId);
    if (!campaignRowId) return;

    const row = await prisma.adGroup.upsert({
      where: { accountId_adGroupId: { accountId, adGroupId: adGroup.adGroupId } },
      create: {
        organizationId,
        accountId,
        campaignRowId,
        adGroupId: adGroup.adGroupId,
        name: adGroup.name,
        status: toEntityStatus(adGroup.status),
        type: adGroup.type,
        cpcBidMicros: adGroup.cpcBidMicros ? BigInt(Math.round(adGroup.cpcBidMicros)) : null,
        targetRoas: adGroup.targetRoas,
        targetCpaMicros: adGroup.targetCpaMicros ? BigInt(Math.round(adGroup.targetCpaMicros)) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        campaignRowId,
        name: adGroup.name,
        status: toEntityStatus(adGroup.status),
        type: adGroup.type,
        cpcBidMicros: adGroup.cpcBidMicros ? BigInt(Math.round(adGroup.cpcBidMicros)) : null,
        targetRoas: adGroup.targetRoas,
        targetCpaMicros: adGroup.targetCpaMicros ? BigInt(Math.round(adGroup.targetCpaMicros)) : null,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    adGroupRowIds.set(adGroup.adGroupId, row.id);
  });

  // ---- keywords -----------------------------------------------------------
  const keywordRowIds = new Map<string, string>();

  await mapWithConcurrency(snapshot.keywords, 8, async (keyword) => {
    const adGroupRowId = adGroupRowIds.get(keyword.adGroupId);
    const campaignRowId = campaignRowIds.get(keyword.campaignId);
    if (!adGroupRowId || !campaignRowId) return;

    const row = await prisma.keyword.upsert({
      where: {
        accountId_adGroupRowId_criterionId: {
          accountId,
          adGroupRowId,
          criterionId: keyword.criterionId,
        },
      },
      create: {
        organizationId,
        accountId,
        campaignRowId,
        adGroupRowId,
        criterionId: keyword.criterionId,
        text: keyword.text,
        matchType: toMatchType(keyword.matchType),
        status: toEntityStatus(keyword.status),
        isNegative: keyword.isNegative,
        cpcBidMicros: keyword.cpcBidMicros ? BigInt(Math.round(keyword.cpcBidMicros)) : null,
        effectiveCpcBidMicros: keyword.effectiveCpcBidMicros
          ? BigInt(Math.round(keyword.effectiveCpcBidMicros))
          : null,
        qualityScore: keyword.qualityScore,
        expectedCtr: keyword.expectedCtr,
        adRelevance: keyword.adRelevance,
        landingPageExp: keyword.landingPageExperience,
        firstPageCpcMicros: keyword.firstPageCpcMicros
          ? BigInt(Math.round(keyword.firstPageCpcMicros))
          : null,
        topOfPageCpcMicros: keyword.topOfPageCpcMicros
          ? BigInt(Math.round(keyword.topOfPageCpcMicros))
          : null,
        finalUrl: keyword.finalUrl,
        lastSyncedAt: new Date(),
      },
      update: {
        campaignRowId,
        text: keyword.text,
        matchType: toMatchType(keyword.matchType),
        status: toEntityStatus(keyword.status),
        isNegative: keyword.isNegative,
        cpcBidMicros: keyword.cpcBidMicros ? BigInt(Math.round(keyword.cpcBidMicros)) : null,
        effectiveCpcBidMicros: keyword.effectiveCpcBidMicros
          ? BigInt(Math.round(keyword.effectiveCpcBidMicros))
          : null,
        qualityScore: keyword.qualityScore,
        expectedCtr: keyword.expectedCtr,
        adRelevance: keyword.adRelevance,
        landingPageExp: keyword.landingPageExperience,
        firstPageCpcMicros: keyword.firstPageCpcMicros
          ? BigInt(Math.round(keyword.firstPageCpcMicros))
          : null,
        topOfPageCpcMicros: keyword.topOfPageCpcMicros
          ? BigInt(Math.round(keyword.topOfPageCpcMicros))
          : null,
        finalUrl: keyword.finalUrl,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    keywordRowIds.set(keyword.criterionId, row.id);
  });

  // ---- ads ----------------------------------------------------------------
  const adRowIds = new Map<string, string>();

  await mapWithConcurrency(snapshot.ads, 8, async (ad) => {
    const adGroupRowId = adGroupRowIds.get(ad.adGroupId);
    const campaignRowId = campaignRowIds.get(ad.campaignId);
    if (!adGroupRowId || !campaignRowId) return;

    const row = await prisma.ad.upsert({
      where: { accountId_adId: { accountId, adId: ad.adId } },
      create: {
        organizationId,
        accountId,
        campaignRowId,
        adGroupRowId,
        adId: ad.adId,
        type: ad.type,
        status: toEntityStatus(ad.status),
        adStrength: ad.adStrength,
        headlines: ad.headlines,
        descriptions: ad.descriptions,
        finalUrls: ad.finalUrls,
        path1: ad.path1,
        path2: ad.path2,
        lastSyncedAt: new Date(),
      },
      update: {
        campaignRowId,
        adGroupRowId,
        type: ad.type,
        status: toEntityStatus(ad.status),
        adStrength: ad.adStrength,
        headlines: ad.headlines,
        descriptions: ad.descriptions,
        finalUrls: ad.finalUrls,
        path1: ad.path1,
        path2: ad.path2,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    adRowIds.set(ad.adId, row.id);
  });

  // ---- search terms -------------------------------------------------------
  const observedDates = snapshot.dailyMetrics.map((row) => row.date).filter(Boolean).sort();
  const today = toDateKey(new Date());
  const windowStartDate = parseDateKey(observedDates[0] ?? today);
  const windowEndDate = parseDateKey(observedDates[observedDates.length - 1] ?? today);

  await mapWithConcurrency(snapshot.searchTerms, 8, async (term) => {
    const key = searchTermKeyFor(term.adGroupId, term.text);
    const adGroupRowId = term.adGroupId ? (adGroupRowIds.get(term.adGroupId) ?? null) : null;
    const campaignRowId = term.campaignId ? (campaignRowIds.get(term.campaignId) ?? null) : null;

    const payload = {
      campaignRowId,
      adGroupRowId,
      text: term.text,
      matchType: toMatchType(term.matchType),
      status: toSearchTermStatus(term.status),
      triggeredKeyword: term.triggeredKeyword,
      windowStart: windowStartDate,
      windowEnd: windowEndDate,
      impressions: BigInt(Math.round(term.impressions)),
      clicks: BigInt(Math.round(term.clicks)),
      costMicros: BigInt(Math.round(term.costMicros)),
      conversions: term.conversions,
      conversionValueMicros: BigInt(Math.round(term.conversionValueMicros)),
      lastSyncedAt: new Date(),
    };

    await prisma.searchTerm.upsert({
      where: { accountId_searchTermKey: { accountId, searchTermKey: key } },
      create: { organizationId, accountId, searchTermKey: key, ...payload },
      update: payload,
    });
  });

  // ---- conversion actions -------------------------------------------------
  await mapWithConcurrency(snapshot.conversions, 8, async (conversion) => {
    const payload = {
      name: conversion.name,
      category: conversion.category,
      type: conversion.type,
      status: conversion.status,
      countingType: conversion.countingType,
      includeInConversionsMetric: conversion.includeInConversionsMetric,
      primaryForGoal: conversion.primaryForGoal,
      valuePerConversionMicros: conversion.valuePerConversionMicros
        ? BigInt(Math.round(conversion.valuePerConversionMicros))
        : null,
      windowStart: windowStartDate,
      windowEnd: windowEndDate,
      conversions: conversion.conversions,
      conversionValueMicros: BigInt(Math.round(conversion.conversionValueMicros)),
      lastSyncedAt: new Date(),
    };

    await prisma.conversion.upsert({
      where: {
        accountId_conversionActionId: {
          accountId,
          conversionActionId: conversion.conversionActionId,
        },
      },
      create: {
        organizationId,
        accountId,
        conversionActionId: conversion.conversionActionId,
        ...payload,
      },
      update: payload,
    });
  });

  // ---- metrics & segments -------------------------------------------------
  const metricRows = snapshot.dailyMetrics.map((row) => ({
    ...row,
    campaignRowId: row.campaignId ? (campaignRowIds.get(row.campaignId) ?? null) : null,
    adGroupRowId: row.adGroupId ? (adGroupRowIds.get(row.adGroupId) ?? null) : null,
    keywordRowId: row.criterionId ? (keywordRowIds.get(row.criterionId) ?? null) : null,
    adRowId: row.adId ? (adRowIds.get(row.adId) ?? null) : null,
  }));

  await bulkUpsertDailyMetrics(organizationId, accountId, metricRows);
  await bulkUpsertSegments(organizationId, accountId, snapshot.segments);

  // ---- reconcile removals -------------------------------------------------
  if (options.full) {
    await reconcileRemovals(accountId, {
      campaignIds: [...campaignRowIds.keys()],
      adGroupIds: [...adGroupRowIds.keys()],
      adIds: [...adRowIds.keys()],
    });
  }

  return {
    campaigns: campaignRowIds.size,
    adGroups: adGroupRowIds.size,
    keywords: keywordRowIds.size,
    ads: adRowIds.size,
    searchTerms: snapshot.searchTerms.length,
    conversions: snapshot.conversions.length,
    dailyMetrics: metricRows.length,
    segments: snapshot.segments.length,
  };
}

/** Anything Google no longer returns is marked REMOVED so history stays intact. */
async function reconcileRemovals(
  accountId: string,
  seen: { campaignIds: string[]; adGroupIds: string[]; adIds: string[] },
): Promise<void> {
  await prisma.campaign.updateMany({
    where: { accountId, campaignId: { notIn: seen.campaignIds }, status: { not: "REMOVED" } },
    data: { status: "REMOVED" },
  });
  await prisma.adGroup.updateMany({
    where: { accountId, adGroupId: { notIn: seen.adGroupIds }, status: { not: "REMOVED" } },
    data: { status: "REMOVED" },
  });
  await prisma.ad.updateMany({
    where: { accountId, adId: { notIn: seen.adIds }, status: { not: "REMOVED" } },
    data: { status: "REMOVED" },
  });
}
