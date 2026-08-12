import "server-only";

import { asNumber, asString, type GoogleAdsClient } from "@/lib/google-ads/client";
import { createLogger } from "@/lib/logger";
import type { DateWindow, NormalizedSegment } from "@/lib/google-ads/types";

/**
 * Segment pulls (device, network, hour, day of week, geography). These power the
 * "when and where does this account actually convert" part of the analysis.
 */

const log = createLogger("google-ads.segments");

type SegmentRow = {
  campaign?: { id?: string };
  segments?: {
    date?: string;
    device?: string;
    adNetworkType?: string;
    hour?: number;
    dayOfWeek?: string;
  };
  geographicView?: { countryCriterionId?: string };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
  };
};

const SEGMENT_METRICS = `
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
`;

function baseSegment(row: SegmentRow): Omit<NormalizedSegment, "segmentType" | "segmentKey" | "segmentLabel"> {
  const metrics = row.metrics ?? {};
  return {
    scope: "CAMPAIGN",
    scopeId: asString(row.campaign?.id),
    date: asString(row.segments?.date),
    impressions: asNumber(metrics.impressions),
    clicks: asNumber(metrics.clicks),
    costMicros: asNumber(metrics.costMicros),
    conversions: metrics.conversions ?? 0,
    conversionValueMicros: Math.round((metrics.conversionsValue ?? 0) * 1_000_000),
  };
}

const DEVICE_LABELS: Record<string, string> = {
  MOBILE: "Mobile",
  DESKTOP: "Desktop",
  TABLET: "Tablet",
  CONNECTED_TV: "Connected TV",
  OTHER: "Other",
};

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

const NETWORK_LABELS: Record<string, string> = {
  SEARCH: "Google search",
  SEARCH_PARTNERS: "Search partners",
  CONTENT: "Display network",
  YOUTUBE_SEARCH: "YouTube search",
  YOUTUBE_WATCH: "YouTube videos",
  MIXED: "Mixed",
};

export async function fetchDeviceSegments(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedSegment[]> {
  const rows = await client.search<SegmentRow>(`
    SELECT campaign.id, segments.date, segments.device, ${SEGMENT_METRICS}
    FROM campaign
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND campaign.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.segments?.device && row.campaign?.id)
    .map((row) => {
      const key = asString(row.segments?.device);
      return {
        ...baseSegment(row),
        segmentType: "DEVICE" as const,
        segmentKey: key,
        segmentLabel: DEVICE_LABELS[key] ?? key,
      };
    });
}

export async function fetchNetworkSegments(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedSegment[]> {
  const rows = await client.search<SegmentRow>(`
    SELECT campaign.id, segments.date, segments.ad_network_type, ${SEGMENT_METRICS}
    FROM campaign
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND campaign.status != 'REMOVED'
  `);

  return rows
    .filter((row) => row.segments?.adNetworkType && row.campaign?.id)
    .map((row) => {
      const key = asString(row.segments?.adNetworkType);
      return {
        ...baseSegment(row),
        segmentType: "NETWORK" as const,
        segmentKey: key,
        segmentLabel: NETWORK_LABELS[key] ?? key,
      };
    });
}

export async function fetchTimeSegments(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedSegment[]> {
  const rows = await client.search<SegmentRow>(`
    SELECT campaign.id, segments.date, segments.hour, segments.day_of_week, ${SEGMENT_METRICS}
    FROM campaign
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
      AND campaign.status != 'REMOVED'
  `);

  const output: NormalizedSegment[] = [];

  for (const row of rows) {
    if (!row.campaign?.id || row.segments?.hour === undefined) continue;
    const base = baseSegment(row);
    const hour = row.segments.hour;

    output.push({
      ...base,
      segmentType: "HOUR_OF_DAY",
      segmentKey: String(hour).padStart(2, "0"),
      segmentLabel: `${String(hour).padStart(2, "0")}:00`,
    });

    const day = asString(row.segments?.dayOfWeek);
    if (day) {
      output.push({
        ...base,
        segmentType: "DAY_OF_WEEK",
        segmentKey: day,
        segmentLabel: DAY_LABELS[day] ?? day,
      });
    }
  }

  return output;
}

/**
 * Geography needs a second lookup: the report returns criterion ids, and the names
 * live in `geo_target_constant`.
 */
export async function fetchLocationSegments(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedSegment[]> {
  const rows = await client.search<SegmentRow>(`
    SELECT campaign.id, segments.date, geographic_view.country_criterion_id, ${SEGMENT_METRICS}
    FROM geographic_view
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
  `);

  const criterionIds = [
    ...new Set(
      rows
        .map((row) => asString(row.geographicView?.countryCriterionId))
        .filter((value) => value.length > 0),
    ),
  ];

  const names = new Map<string, string>();
  if (criterionIds.length > 0) {
    try {
      const constants = await client.search<{
        geoTargetConstant?: { id?: string; canonicalName?: string; name?: string };
      }>(`
        SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name
        FROM geo_target_constant
        WHERE geo_target_constant.id IN (${criterionIds.slice(0, 500).join(",")})
      `);
      for (const constant of constants) {
        const id = asString(constant.geoTargetConstant?.id);
        const label = constant.geoTargetConstant?.name ?? constant.geoTargetConstant?.canonicalName;
        if (id && label) names.set(id, label);
      }
    } catch (error) {
      log.warn("could not resolve geo target names", { error });
    }
  }

  return rows
    .filter((row) => row.campaign?.id && row.geographicView?.countryCriterionId)
    .map((row) => {
      const key = asString(row.geographicView?.countryCriterionId);
      return {
        ...baseSegment(row),
        segmentType: "LOCATION" as const,
        segmentKey: key,
        segmentLabel: names.get(key) ?? `Location ${key}`,
      };
    });
}
