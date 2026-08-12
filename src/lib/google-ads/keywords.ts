import "server-only";

import {
  asOptionalNumber,
  asOptionalString,
  asString,
  type GoogleAdsClient,
} from "@/lib/google-ads/client";
import { toEntityStatus } from "@/lib/google-ads/campaigns";
import type { AdsMatchType, NormalizedKeyword } from "@/lib/google-ads/types";

const KEYWORD_QUERY = `
  SELECT
    ad_group_criterion.criterion_id,
    ad_group_criterion.keyword.text,
    ad_group_criterion.keyword.match_type,
    ad_group_criterion.status,
    ad_group_criterion.negative,
    ad_group_criterion.cpc_bid_micros,
    ad_group_criterion.effective_cpc_bid_micros,
    ad_group_criterion.final_urls,
    ad_group_criterion.quality_info.quality_score,
    ad_group_criterion.quality_info.creative_quality_score,
    ad_group_criterion.quality_info.search_predicted_ctr,
    ad_group_criterion.quality_info.post_click_quality_score,
    ad_group_criterion.position_estimates.first_page_cpc_micros,
    ad_group_criterion.position_estimates.top_of_page_cpc_micros,
    ad_group.id,
    campaign.id
  FROM keyword_view
  WHERE ad_group_criterion.status != 'REMOVED'
`;

/** Negative keywords live on the criterion table with `negative = true`. */
const NEGATIVE_KEYWORD_QUERY = `
  SELECT
    campaign_criterion.criterion_id,
    campaign_criterion.keyword.text,
    campaign_criterion.keyword.match_type,
    campaign_criterion.status,
    campaign.id
  FROM campaign_criterion
  WHERE campaign_criterion.negative = true
    AND campaign_criterion.type = 'KEYWORD'
    AND campaign_criterion.status != 'REMOVED'
`;

type KeywordRow = {
  adGroupCriterion?: {
    criterionId?: string;
    status?: string;
    negative?: boolean;
    cpcBidMicros?: string;
    effectiveCpcBidMicros?: string;
    finalUrls?: string[];
    keyword?: { text?: string; matchType?: string };
    qualityInfo?: {
      qualityScore?: number;
      creativeQualityScore?: string;
      searchPredictedCtr?: string;
      postClickQualityScore?: string;
    };
    positionEstimates?: { firstPageCpcMicros?: string; topOfPageCpcMicros?: string };
  };
  adGroup?: { id?: string };
  campaign?: { id?: string };
};

type NegativeKeywordRow = {
  campaignCriterion?: {
    criterionId?: string;
    keyword?: { text?: string; matchType?: string };
    status?: string;
  };
  campaign?: { id?: string };
};

export function toMatchType(value: unknown): AdsMatchType {
  switch (asString(value).toUpperCase()) {
    case "EXACT":
      return "EXACT";
    case "PHRASE":
      return "PHRASE";
    case "BROAD":
      return "BROAD";
    default:
      return "UNKNOWN";
  }
}

export async function fetchKeywords(client: GoogleAdsClient): Promise<NormalizedKeyword[]> {
  const rows = await client.search<KeywordRow>(KEYWORD_QUERY);

  return rows
    .filter((row) => row.adGroupCriterion?.criterionId && row.adGroup?.id)
    .map((row) => {
      const criterion = row.adGroupCriterion ?? {};
      return {
        criterionId: asString(criterion.criterionId),
        adGroupId: asString(row.adGroup?.id),
        campaignId: asString(row.campaign?.id),
        text: criterion.keyword?.text ?? "",
        matchType: toMatchType(criterion.keyword?.matchType),
        status: toEntityStatus(criterion.status),
        isNegative: Boolean(criterion.negative),
        cpcBidMicros: asOptionalNumber(criterion.cpcBidMicros),
        effectiveCpcBidMicros: asOptionalNumber(criterion.effectiveCpcBidMicros),
        qualityScore: asOptionalNumber(criterion.qualityInfo?.qualityScore),
        expectedCtr: asOptionalString(criterion.qualityInfo?.searchPredictedCtr),
        adRelevance: asOptionalString(criterion.qualityInfo?.creativeQualityScore),
        landingPageExperience: asOptionalString(criterion.qualityInfo?.postClickQualityScore),
        firstPageCpcMicros: asOptionalNumber(criterion.positionEstimates?.firstPageCpcMicros),
        topOfPageCpcMicros: asOptionalNumber(criterion.positionEstimates?.topOfPageCpcMicros),
        finalUrl: criterion.finalUrls?.[0] ?? null,
      } satisfies NormalizedKeyword;
    })
    .filter((keyword) => keyword.text.length > 0);
}

export type ExistingNegative = {
  criterionId: string;
  campaignId: string;
  text: string;
  matchType: AdsMatchType;
};

/** Used before adding negatives so the optimizer never proposes a duplicate. */
export async function fetchCampaignNegativeKeywords(
  client: GoogleAdsClient,
): Promise<ExistingNegative[]> {
  const rows = await client.search<NegativeKeywordRow>(NEGATIVE_KEYWORD_QUERY);

  return rows
    .filter((row) => row.campaignCriterion?.keyword?.text)
    .map((row) => ({
      criterionId: asString(row.campaignCriterion?.criterionId),
      campaignId: asString(row.campaign?.id),
      text: row.campaignCriterion?.keyword?.text ?? "",
      matchType: toMatchType(row.campaignCriterion?.keyword?.matchType),
    }));
}
