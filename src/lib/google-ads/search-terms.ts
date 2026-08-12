import "server-only";

import { asNumber, asString, type GoogleAdsClient } from "@/lib/google-ads/client";
import { toMatchType } from "@/lib/google-ads/keywords";
import type { DateWindow, NormalizedSearchTerm } from "@/lib/google-ads/types";

/**
 * Search terms are pulled as an aggregate over the reporting window. Google already
 * aggregates when `segments.date` is only used in the WHERE clause, which keeps the
 * row count manageable on large accounts.
 */

type SearchTermRow = {
  searchTermView?: { searchTerm?: string; status?: string };
  segments?: { keyword?: { info?: { text?: string; matchType?: string } }; searchTermMatchType?: string };
  adGroup?: { id?: string };
  campaign?: { id?: string };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
  };
};

function toSearchTermStatus(value: unknown): NormalizedSearchTerm["status"] {
  switch (asString(value).toUpperCase()) {
    case "ADDED":
      return "ADDED";
    case "EXCLUDED":
      return "EXCLUDED";
    case "ADDED_EXCLUDED":
      return "ADDED_EXCLUDED";
    case "NONE":
      return "NONE";
    default:
      return "UNKNOWN";
  }
}

export function buildSearchTermQuery(window: DateWindow): string {
  return `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      segments.search_term_match_type,
      segments.keyword.info.text,
      ad_group.id,
      campaign.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND metrics.impressions > 0
  `;
}

export async function fetchSearchTerms(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedSearchTerm[]> {
  const rows = await client.search<SearchTermRow>(buildSearchTermQuery(window));

  // Google can return one row per (term, match type, keyword); collapse to one per
  // (ad group, term) because that is the unit an optimization acts on.
  const merged = new Map<string, NormalizedSearchTerm>();

  for (const row of rows) {
    const text = row.searchTermView?.searchTerm?.trim();
    if (!text) continue;

    const adGroupId = row.adGroup?.id ? asString(row.adGroup.id) : null;
    const key = `${adGroupId ?? "none"}:${text.toLowerCase()}`;
    const metrics = row.metrics ?? {};

    const existing = merged.get(key);
    const addition: NormalizedSearchTerm = {
      text,
      adGroupId,
      campaignId: row.campaign?.id ? asString(row.campaign.id) : null,
      matchType: toMatchType(row.segments?.searchTermMatchType),
      status: toSearchTermStatus(row.searchTermView?.status),
      triggeredKeyword: row.segments?.keyword?.info?.text ?? null,
      impressions: asNumber(metrics.impressions),
      clicks: asNumber(metrics.clicks),
      costMicros: asNumber(metrics.costMicros),
      conversions: metrics.conversions ?? 0,
      conversionValueMicros: Math.round((metrics.conversionsValue ?? 0) * 1_000_000),
    };

    if (!existing) {
      merged.set(key, addition);
      continue;
    }

    merged.set(key, {
      ...existing,
      impressions: existing.impressions + addition.impressions,
      clicks: existing.clicks + addition.clicks,
      costMicros: existing.costMicros + addition.costMicros,
      conversions: existing.conversions + addition.conversions,
      conversionValueMicros: existing.conversionValueMicros + addition.conversionValueMicros,
      triggeredKeyword: existing.triggeredKeyword ?? addition.triggeredKeyword,
    });
  }

  return [...merged.values()];
}
