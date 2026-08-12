import "server-only";

import { asOptionalNumber, asString, type GoogleAdsClient } from "@/lib/google-ads/client";
import { createLogger } from "@/lib/logger";
import type { GoogleRecommendation } from "@/lib/google-ads/types";

/**
 * Google's own recommendations. They are treated as one input signal among many —
 * never auto-applied — because they optimize for Google's objectives, not the
 * advertiser's profit target.
 */

const log = createLogger("google-ads.recommendations");

type RecommendationRow = {
  recommendation?: {
    resourceName?: string;
    type?: string;
    impact?: {
      baseMetrics?: { costMicros?: string; conversions?: number };
      potentialMetrics?: { costMicros?: string; conversions?: number };
    };
    campaignBudgetRecommendation?: { budgetOptions?: unknown };
  };
};

export async function fetchGoogleRecommendations(
  client: GoogleAdsClient,
): Promise<GoogleRecommendation[]> {
  try {
    const rows = await client.search<RecommendationRow>(`
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.impact.base_metrics.cost_micros,
        recommendation.impact.base_metrics.conversions,
        recommendation.impact.potential_metrics.cost_micros,
        recommendation.impact.potential_metrics.conversions
      FROM recommendation
    `);

    return rows
      .filter((row) => row.recommendation?.type)
      .map((row) => {
        const impact = row.recommendation?.impact;
        return {
          resourceName: asString(row.recommendation?.resourceName),
          type: asString(row.recommendation?.type),
          description: null,
          impact: impact
            ? {
                baseCost: asOptionalNumber(impact.baseMetrics?.costMicros),
                potentialCost: asOptionalNumber(impact.potentialMetrics?.costMicros),
                baseConversions: asOptionalNumber(impact.baseMetrics?.conversions),
                potentialConversions: asOptionalNumber(impact.potentialMetrics?.conversions),
              }
            : null,
        };
      });
  } catch (error) {
    // Recommendations are optional context; a failure here must not fail a sync.
    log.warn("could not load google recommendations", { error });
    return [];
  }
}
