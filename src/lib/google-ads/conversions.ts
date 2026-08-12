import "server-only";

import {
  asNumber,
  asOptionalNumber,
  asOptionalString,
  asString,
  idFromResourceName,
  type GoogleAdsClient,
} from "@/lib/google-ads/client";
import type { DateWindow, NormalizedConversionAction } from "@/lib/google-ads/types";

const CONVERSION_ACTION_QUERY = `
  SELECT
    conversion_action.id,
    conversion_action.name,
    conversion_action.category,
    conversion_action.type,
    conversion_action.status,
    conversion_action.counting_type,
    conversion_action.include_in_conversions_metric,
    conversion_action.primary_for_goal,
    conversion_action.value_settings.default_value
  FROM conversion_action
  WHERE conversion_action.status != 'REMOVED'
`;

type ConversionActionRow = {
  conversionAction?: {
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    status?: string;
    countingType?: string;
    includeInConversionsMetric?: boolean;
    primaryForGoal?: boolean;
    valueSettings?: { defaultValue?: number };
  };
};

type ConversionStatsRow = {
  segments?: { conversionAction?: string; conversionActionName?: string };
  metrics?: { allConversions?: number; allConversionsValue?: number };
};

/**
 * Conversion action definitions plus their totals for the window. Used both for the
 * conversions view and by the tracking-health checks (an action that suddenly reports
 * nothing is usually a broken tag, not a market change).
 */
export async function fetchConversionActions(
  client: GoogleAdsClient,
  window: DateWindow,
): Promise<NormalizedConversionAction[]> {
  const [definitions, stats] = await Promise.all([
    client.search<ConversionActionRow>(CONVERSION_ACTION_QUERY),
    client.search<ConversionStatsRow>(`
      SELECT
        segments.conversion_action,
        segments.conversion_action_name,
        metrics.all_conversions,
        metrics.all_conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
    `),
  ]);

  const totals = new Map<string, { conversions: number; valueMicros: number }>();
  for (const row of stats) {
    const id = idFromResourceName(row.segments?.conversionAction);
    if (!id) continue;
    const current = totals.get(id) ?? { conversions: 0, valueMicros: 0 };
    totals.set(id, {
      conversions: current.conversions + (row.metrics?.allConversions ?? 0),
      valueMicros:
        current.valueMicros + Math.round((row.metrics?.allConversionsValue ?? 0) * 1_000_000),
    });
  }

  return definitions
    .filter((row) => row.conversionAction?.id)
    .map((row) => {
      const action = row.conversionAction ?? {};
      const id = asString(action.id);
      const total = totals.get(id);

      return {
        conversionActionId: id,
        name: action.name ?? "Unnamed conversion",
        category: asOptionalString(action.category),
        type: asOptionalString(action.type),
        status: asOptionalString(action.status),
        countingType: asOptionalString(action.countingType),
        includeInConversionsMetric: action.includeInConversionsMetric ?? true,
        primaryForGoal: action.primaryForGoal ?? true,
        valuePerConversionMicros: action.valueSettings?.defaultValue
          ? Math.round(asNumber(action.valueSettings.defaultValue) * 1_000_000)
          : null,
        conversions: total?.conversions ?? 0,
        conversionValueMicros: total?.valueMicros ?? 0,
      } satisfies NormalizedConversionAction;
    });
}

export async function fetchConversionValueSettings(
  client: GoogleAdsClient,
): Promise<{ hasValueTracking: boolean; primaryActions: number }> {
  const rows = await client.search<ConversionActionRow>(CONVERSION_ACTION_QUERY);
  const primary = rows.filter((row) => row.conversionAction?.primaryForGoal);
  const withValue = rows.filter((row) => asOptionalNumber(row.conversionAction?.valueSettings?.defaultValue));
  return { hasValueTracking: withValue.length > 0, primaryActions: primary.length };
}
