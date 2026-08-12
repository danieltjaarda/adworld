import "server-only";

import {
  asNumber,
  asOptionalNumber,
  asOptionalString,
  asString,
  type GoogleAdsClient,
} from "@/lib/google-ads/client";
import type {
  AdsEntityStatus,
  NormalizedAdGroup,
  NormalizedCampaign,
} from "@/lib/google-ads/types";

const CAMPAIGN_QUERY = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    campaign.advertising_channel_type,
    campaign.bidding_strategy_type,
    campaign.start_date,
    campaign.end_date,
    campaign.optimization_score,
    campaign.target_roas.target_roas,
    campaign.target_cpa.target_cpa_micros,
    campaign.maximize_conversion_value.target_roas,
    campaign.maximize_conversions.target_cpa_micros,
    campaign_budget.id,
    campaign_budget.name,
    campaign_budget.amount_micros,
    campaign_budget.explicitly_shared,
    campaign_budget.delivery_method
  FROM campaign
  WHERE campaign.status != 'REMOVED'
`;

const AD_GROUP_QUERY = `
  SELECT
    ad_group.id,
    ad_group.name,
    ad_group.status,
    ad_group.type,
    ad_group.cpc_bid_micros,
    ad_group.target_roas,
    ad_group.target_cpa_micros,
    campaign.id
  FROM ad_group
  WHERE ad_group.status != 'REMOVED'
`;

type CampaignRow = {
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    biddingStrategyType?: string;
    startDate?: string;
    endDate?: string;
    optimizationScore?: number;
    targetRoas?: { targetRoas?: number };
    targetCpa?: { targetCpaMicros?: string };
    maximizeConversionValue?: { targetRoas?: number };
    maximizeConversions?: { targetCpaMicros?: string };
  };
  campaignBudget?: {
    id?: string;
    name?: string;
    amountMicros?: string;
    explicitlyShared?: boolean;
    deliveryMethod?: string;
  };
};

type AdGroupRow = {
  adGroup?: {
    id?: string;
    name?: string;
    status?: string;
    type?: string;
    cpcBidMicros?: string;
    targetRoas?: number;
    targetCpaMicros?: string;
  };
  campaign?: { id?: string };
};

export function toEntityStatus(value: unknown): AdsEntityStatus {
  switch (asString(value).toUpperCase()) {
    case "ENABLED":
      return "ENABLED";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "REMOVED";
    default:
      return "UNKNOWN";
  }
}

export async function fetchCampaigns(client: GoogleAdsClient): Promise<NormalizedCampaign[]> {
  const rows = await client.search<CampaignRow>(CAMPAIGN_QUERY);

  return rows
    .filter((row) => row.campaign?.id)
    .map((row) => {
      const campaign = row.campaign ?? {};
      const budget = row.campaignBudget ?? {};

      return {
        campaignId: asString(campaign.id),
        name: campaign.name ?? "Untitled campaign",
        status: toEntityStatus(campaign.status),
        advertisingChannel: campaign.advertisingChannelType ?? "UNSPECIFIED",
        biddingStrategyType: asOptionalString(campaign.biddingStrategyType),
        budgetId: asOptionalString(budget.id),
        budgetName: asOptionalString(budget.name),
        budgetAmountMicros: asNumber(budget.amountMicros),
        budgetIsShared: Boolean(budget.explicitlyShared),
        budgetDeliveryMethod: asOptionalString(budget.deliveryMethod),
        targetRoas:
          asOptionalNumber(campaign.targetRoas?.targetRoas) ??
          asOptionalNumber(campaign.maximizeConversionValue?.targetRoas),
        targetCpaMicros:
          asOptionalNumber(campaign.targetCpa?.targetCpaMicros) ??
          asOptionalNumber(campaign.maximizeConversions?.targetCpaMicros),
        startDate: asOptionalString(campaign.startDate),
        endDate: asOptionalString(campaign.endDate),
        optimizationScore: asOptionalNumber(campaign.optimizationScore),
      } satisfies NormalizedCampaign;
    });
}

export async function fetchAdGroups(client: GoogleAdsClient): Promise<NormalizedAdGroup[]> {
  const rows = await client.search<AdGroupRow>(AD_GROUP_QUERY);

  return rows
    .filter((row) => row.adGroup?.id && row.campaign?.id)
    .map((row) => ({
      adGroupId: asString(row.adGroup?.id),
      campaignId: asString(row.campaign?.id),
      name: row.adGroup?.name ?? "Untitled ad group",
      status: toEntityStatus(row.adGroup?.status),
      type: asOptionalString(row.adGroup?.type),
      cpcBidMicros: asOptionalNumber(row.adGroup?.cpcBidMicros),
      targetRoas: asOptionalNumber(row.adGroup?.targetRoas),
      targetCpaMicros: asOptionalNumber(row.adGroup?.targetCpaMicros),
    }));
}
