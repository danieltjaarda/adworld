import "server-only";

import { asOptionalString, asString, type GoogleAdsClient } from "@/lib/google-ads/client";
import { toEntityStatus } from "@/lib/google-ads/campaigns";
import type { NormalizedAd } from "@/lib/google-ads/types";

const AD_QUERY = `
  SELECT
    ad_group_ad.ad.id,
    ad_group_ad.ad.type,
    ad_group_ad.ad.final_urls,
    ad_group_ad.ad.responsive_search_ad.headlines,
    ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.responsive_search_ad.path1,
    ad_group_ad.ad.responsive_search_ad.path2,
    ad_group_ad.ad.expanded_text_ad.headline_part1,
    ad_group_ad.ad.expanded_text_ad.headline_part2,
    ad_group_ad.ad.expanded_text_ad.description,
    ad_group_ad.status,
    ad_group_ad.ad_strength,
    ad_group.id,
    campaign.id
  FROM ad_group_ad
  WHERE ad_group_ad.status != 'REMOVED'
`;

type AssetText = { text?: string; pinnedField?: string };

type AdRow = {
  adGroupAd?: {
    status?: string;
    adStrength?: string;
    ad?: {
      id?: string;
      type?: string;
      finalUrls?: string[];
      responsiveSearchAd?: {
        headlines?: AssetText[];
        descriptions?: AssetText[];
        path1?: string;
        path2?: string;
      };
      expandedTextAd?: {
        headlinePart1?: string;
        headlinePart2?: string;
        description?: string;
      };
    };
  };
  adGroup?: { id?: string };
  campaign?: { id?: string };
};

function assetTexts(assets: AssetText[] | undefined): string[] {
  return (assets ?? []).map((asset) => asset.text ?? "").filter((text) => text.length > 0);
}

export async function fetchAds(client: GoogleAdsClient): Promise<NormalizedAd[]> {
  const rows = await client.search<AdRow>(AD_QUERY);

  return rows
    .filter((row) => row.adGroupAd?.ad?.id && row.adGroup?.id)
    .map((row) => {
      const ad = row.adGroupAd?.ad ?? {};
      const rsa = ad.responsiveSearchAd;
      const eta = ad.expandedTextAd;

      const headlines = rsa
        ? assetTexts(rsa.headlines)
        : [eta?.headlinePart1, eta?.headlinePart2].filter((value): value is string => Boolean(value));
      const descriptions = rsa
        ? assetTexts(rsa.descriptions)
        : [eta?.description].filter((value): value is string => Boolean(value));

      return {
        adId: asString(ad.id),
        adGroupId: asString(row.adGroup?.id),
        campaignId: asString(row.campaign?.id),
        type: ad.type ?? "UNKNOWN",
        status: toEntityStatus(row.adGroupAd?.status),
        adStrength: asOptionalString(row.adGroupAd?.adStrength),
        headlines,
        descriptions,
        finalUrls: ad.finalUrls ?? [],
        path1: asOptionalString(rsa?.path1),
        path2: asOptionalString(rsa?.path2),
      } satisfies NormalizedAd;
    });
}
