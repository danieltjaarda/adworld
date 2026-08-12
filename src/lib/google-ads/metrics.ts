import "server-only";

import { asNumber, asString, type GoogleAdsClient } from "@/lib/google-ads/client";
import type { DateWindow, MetricLevelName, NormalizedDailyMetric } from "@/lib/google-ads/types";

/**
 * Daily performance pulls. One query per level, each segmented by date, so the local
 * warehouse can answer any date-range comparison without touching the API again.
 */

type MetricsPayload = {
  impressions?: string;
  clicks?: string;
  costMicros?: string;
  conversions?: number;
  conversionsValue?: number;
  allConversions?: number;
  allConversionsValue?: number;
  interactions?: string;
  videoViews?: string;
  searchImpressionShare?: number;
  searchBudgetLostImpressionShare?: number;
  searchRankLostImpressionShare?: number;
  topImpressionPercentage?: number;
};

type MetricRow = {
  segments?: { date?: string };
  metrics?: MetricsPayload;
  customer?: { id?: string };
  campaign?: { id?: string };
  adGroup?: { id?: string };
  adGroupCriterion?: { criterionId?: string };
  adGroupAd?: { ad?: { id?: string } };
};

const BASE_METRICS = `
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.all_conversions,
  metrics.all_conversions_value,
  metrics.interactions
`;

const SHARE_METRICS = `
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.top_impression_percentage
`;

function toDailyMetric(
  row: MetricRow,
  level: MetricLevelName,
  entityId: string,
  extras: Partial<NormalizedDailyMetric> = {},
): NormalizedDailyMetric {
  const metrics = row.metrics ?? {};
  return {
    level,
    entityId,
    date: asString(row.segments?.date),
    impressions: asNumber(metrics.impressions),
    clicks: asNumber(metrics.clicks),
    costMicros: asNumber(metrics.costMicros),
    conversions: metrics.conversions ?? 0,
    conversionValueMicros: Math.round((metrics.conversionsValue ?? 0) * 1_000_000),
    allConversions: metrics.allConversions ?? 0,
    allConversionValueMicros: Math.round((metrics.allConversionsValue ?? 0) * 1_000_000),
    interactions: asNumber(metrics.interactions),
    videoViews: asNumber(metrics.videoViews),
    searchImpressionShare: metrics.searchImpressionShare ?? null,
    searchBudgetLostImprShare: metrics.searchBudgetLostImpressionShare ?? null,
    searchRankLostImprShare: metrics.searchRankLostImpressionShare ?? null,
    topImpressionPercentage: metrics.topImpressionPercentage ?? null,
    ...extras,
  };
}

export async function fetchAccountDailyMetrics(
  client: GoogleAdsClient,
  customerId: string,
  window: DateWindow,
): Promise<NormalizedDailyMetric[]> {
  const rows = await client.search<MetricRow>(`
    SELECT
      segments.date,
      ${BASE_METRICS},
      ${SHARE_METRICS}
    FROM customer
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
  `);

  return rows
    .filter((row) => row.segments?.date)
    .map((row) => toDailyMetric(row, "ACCOUNT", customerId));
}

export async function fetchCampaignDailyMetrics(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedDailyMetric[]> {
  const rows = await client.search<MetricRow>(`
    SELECT
      campaign.id,
      segments.date,
      ${BASE_METRICS},
      ${SHARE_METRICS}
    FROM campaign
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND campaign.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.campaign?.id && row.segments?.date)
    .map((row) =>
      toDailyMetric(row, "CAMPAIGN", asString(row.campaign?.id), {
        campaignId: asString(row.campaign?.id),
      }),
    );
}

export async function fetchAdGroupDailyMetrics(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedDailyMetric[]> {
  const rows = await client.search<MetricRow>(`
    SELECT
      ad_group.id,
      campaign.id,
      segments.date,
      ${BASE_METRICS}
    FROM ad_group
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND ad_group.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.adGroup?.id && row.segments?.date)
    .map((row) =>
      toDailyMetric(row, "AD_GROUP", asString(row.adGroup?.id), {
        campaignId: asString(row.campaign?.id),
        adGroupId: asString(row.adGroup?.id),
      }),
    );
}

export async function fetchKeywordDailyMetrics(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedDailyMetric[]> {
  const rows = await client.search<MetricRow>(`
    SELECT
      ad_group_criterion.criterion_id,
      ad_group.id,
      campaign.id,
      segments.date,
      ${BASE_METRICS}
    FROM keyword_view
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND ad_group_criterion.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.adGroupCriterion?.criterionId && row.segments?.date)
    .map((row) =>
      toDailyMetric(row, "KEYWORD", asString(row.adGroupCriterion?.criterionId), {
        campaignId: asString(row.campaign?.id),
        adGroupId: asString(row.adGroup?.id),
        criterionId: asString(row.adGroupCriterion?.criterionId),
      }),
    );
}

export async function fetchAdDailyMetrics(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedDailyMetric[]> {
  const rows = await client.search<MetricRow>(`
    SELECT
      ad_group_ad.ad.id,
      ad_group.id,
      campaign.id,
      segments.date,
      ${BASE_METRICS}
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND ad_group_ad.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.adGroupAd?.ad?.id && row.segments?.date)
    .map((row) =>
      toDailyMetric(row, "AD", asString(row.adGroupAd?.ad?.id), {
        campaignId: asString(row.campaign?.id),
        adGroupId: asString(row.adGroup?.id),
        adId: asString(row.adGroupAd?.ad?.id),
      }),
    );
}
