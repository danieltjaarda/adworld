import "server-only";

import { createLogger } from "@/lib/logger";
import { GoogleAdsClient } from "@/lib/google-ads/client";
import { fetchAdGroups, fetchCampaigns } from "@/lib/google-ads/campaigns";
import { fetchAds } from "@/lib/google-ads/ads";
import { fetchConversionActions } from "@/lib/google-ads/conversions";
import { fetchKeywords } from "@/lib/google-ads/keywords";
import {
  fetchAccountDailyMetrics,
  fetchAdDailyMetrics,
  fetchAdGroupDailyMetrics,
  fetchCampaignDailyMetrics,
  fetchKeywordDailyMetrics,
} from "@/lib/google-ads/metrics";
import { executeMutation } from "@/lib/google-ads/mutations";
import { fetchGoogleRecommendations } from "@/lib/google-ads/recommendations";
import {
  fetchDeviceSegments,
  fetchLocationSegments,
  fetchNetworkSegments,
  fetchTimeSegments,
} from "@/lib/google-ads/segments";
import { fetchSearchTerms } from "@/lib/google-ads/search-terms";
import { listAccessibleAccounts } from "@/lib/google-ads/accounts";
import { buildDemoSnapshot, demoAccessibleAccounts } from "@/lib/google-ads/demo/dataset";
import type {
  AccessibleCustomer,
  DateWindow,
  GoogleRecommendation,
  MutationRequest,
  MutationResult,
  NormalizedAd,
  NormalizedAdGroup,
  NormalizedCampaign,
  NormalizedConversionAction,
  NormalizedDailyMetric,
  NormalizedKeyword,
  NormalizedSearchTerm,
  NormalizedSegment,
} from "@/lib/google-ads/types";

/**
 * Provider abstraction.
 *
 * The sync pipeline and the action executor only ever talk to this interface, so a
 * demo account and a live account follow exactly the same code path. When credentials
 * are missing the demo provider takes over and the product stays fully explorable.
 */

const log = createLogger("google-ads.provider");

export type AccountSnapshot = {
  campaigns: NormalizedCampaign[];
  adGroups: NormalizedAdGroup[];
  keywords: NormalizedKeyword[];
  ads: NormalizedAd[];
  searchTerms: NormalizedSearchTerm[];
  conversions: NormalizedConversionAction[];
  dailyMetrics: NormalizedDailyMetric[];
  segments: NormalizedSegment[];
  googleRecommendations: GoogleRecommendation[];
};

export interface AdsProvider {
  readonly mode: "live" | "demo";
  readonly customerId: string;
  fetchSnapshot(window: DateWindow): Promise<AccountSnapshot>;
  applyMutation(request: MutationRequest, options?: { validateOnly?: boolean }): Promise<MutationResult>;
}

// ---------------------------------------------------------------------------
// Live provider
// ---------------------------------------------------------------------------

class LiveAdsProvider implements AdsProvider {
  readonly mode = "live" as const;

  constructor(
    readonly customerId: string,
    private readonly client: GoogleAdsClient,
  ) {}

  async fetchSnapshot(window: DateWindow): Promise<AccountSnapshot> {
    // Structure and metrics are independent; fetch them together to keep syncs short.
    const [campaigns, adGroups, keywords, ads, searchTerms, conversions] = await Promise.all([
      fetchCampaigns(this.client),
      fetchAdGroups(this.client),
      fetchKeywords(this.client),
      fetchAds(this.client),
      fetchSearchTerms(this.client, window),
      fetchConversionActions(this.client, window),
    ]);

    const [accountMetrics, campaignMetrics, adGroupMetrics, keywordMetrics, adMetrics] =
      await Promise.all([
        fetchAccountDailyMetrics(this.client, this.customerId, window),
        fetchCampaignDailyMetrics(this.client, window),
        fetchAdGroupDailyMetrics(this.client, window),
        fetchKeywordDailyMetrics(this.client, window),
        fetchAdDailyMetrics(this.client, window),
      ]);

    const [deviceSegments, networkSegments, timeSegments, locationSegments, googleRecommendations] =
      await Promise.all([
        fetchDeviceSegments(this.client, window),
        fetchNetworkSegments(this.client, window),
        fetchTimeSegments(this.client, window),
        fetchLocationSegments(this.client, window),
        fetchGoogleRecommendations(this.client),
      ]);

    return {
      campaigns,
      adGroups,
      keywords,
      ads,
      searchTerms,
      conversions,
      dailyMetrics: [
        ...accountMetrics,
        ...campaignMetrics,
        ...adGroupMetrics,
        ...keywordMetrics,
        ...adMetrics,
      ],
      segments: [...deviceSegments, ...networkSegments, ...timeSegments, ...locationSegments],
      googleRecommendations,
    };
  }

  async applyMutation(
    request: MutationRequest,
    options: { validateOnly?: boolean } = {},
  ): Promise<MutationResult> {
    return executeMutation(this.client, this.customerId, request, options);
  }
}

// ---------------------------------------------------------------------------
// Demo provider
// ---------------------------------------------------------------------------

class DemoAdsProvider implements AdsProvider {
  readonly mode = "demo" as const;

  constructor(
    readonly customerId: string,
    private readonly seedKey: string,
  ) {}

  async fetchSnapshot(window: DateWindow): Promise<AccountSnapshot> {
    const snapshot = buildDemoSnapshot(this.seedKey, window);
    return { ...snapshot, googleRecommendations: [] };
  }

  async applyMutation(
    request: MutationRequest,
    options: { validateOnly?: boolean } = {},
  ): Promise<MutationResult> {
    log.info("demo mutation accepted", { kind: request.kind, validateOnly: options.validateOnly });
    return {
      success: true,
      resourceName: `demo/${request.kind}/${Date.now()}`,
      validatedOnly: Boolean(options.validateOnly),
      message: "Applied to the demo account. No live Google Ads data was changed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ProviderAccount = {
  id: string;
  customerId: string;
  isDemo: boolean;
  loginCustomerId?: string | null;
};

export function createProvider(
  account: ProviderAccount,
  credentials: { accessToken: string } | null,
): AdsProvider {
  if (account.isDemo || !credentials) {
    return new DemoAdsProvider(account.customerId, account.id);
  }

  return new LiveAdsProvider(
    account.customerId,
    new GoogleAdsClient({
      accessToken: credentials.accessToken,
      customerId: account.customerId,
      loginCustomerId: account.loginCustomerId,
    }),
  );
}

export async function listAccountsForConnection(
  accessToken: string | null,
): Promise<AccessibleCustomer[]> {
  if (!accessToken) return demoAccessibleAccounts();
  return listAccessibleAccounts(accessToken);
}

export { demoAccessibleAccounts };
