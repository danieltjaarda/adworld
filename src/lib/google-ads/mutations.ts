import "server-only";

import { GoogleAdsClient, normalizeCustomerId } from "@/lib/google-ads/client";
import { createLogger } from "@/lib/logger";
import type { MutationRequest, MutationResult } from "@/lib/google-ads/types";

/**
 * The single write path to Google Ads.
 *
 * Nothing else in the codebase calls a mutate endpoint. Every request arrives as a
 * validated `MutationRequest` from the action executor, which has already checked
 * tenancy, optimization mode and the safety limits.
 */

const log = createLogger("google-ads.mutations");

type MutateResponse = {
  results?: Array<{ resourceName?: string }>;
  partialFailureError?: { message?: string };
};

function campaignResource(customerId: string, campaignId: string): string {
  return `customers/${customerId}/campaigns/${campaignId}`;
}

function budgetResource(customerId: string, budgetId: string): string {
  return `customers/${customerId}/campaignBudgets/${budgetId}`;
}

function adGroupResource(customerId: string, adGroupId: string): string {
  return `customers/${customerId}/adGroups/${adGroupId}`;
}

function criterionResource(customerId: string, adGroupId: string, criterionId: string): string {
  return `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`;
}

function adGroupAdResource(customerId: string, adGroupId: string, adId: string): string {
  return `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;
}

type MutationPlan = {
  endpoint: string;
  body: Record<string, unknown>;
  description: string;
};

/** Translates a domain mutation into the REST payload, without executing it. */
export function planMutation(customerId: string, request: MutationRequest): MutationPlan {
  const cid = normalizeCustomerId(customerId);

  switch (request.kind) {
    case "campaign_budget":
      return {
        endpoint: "campaignBudgets:mutate",
        description: `Set budget ${request.budgetId} to ${request.amountMicros} micros/day`,
        body: {
          operations: [
            {
              update: {
                resourceName: budgetResource(cid, request.budgetId),
                amountMicros: String(request.amountMicros),
              },
              updateMask: "amount_micros",
            },
          ],
        },
      };

    case "keyword_bid":
      return {
        endpoint: "adGroupCriteria:mutate",
        description: `Set keyword ${request.criterionId} bid to ${request.cpcBidMicros} micros`,
        body: {
          operations: [
            {
              update: {
                resourceName: criterionResource(cid, request.adGroupId, request.criterionId),
                cpcBidMicros: String(request.cpcBidMicros),
              },
              updateMask: "cpc_bid_micros",
            },
          ],
        },
      };

    case "keyword_status":
      return {
        endpoint: "adGroupCriteria:mutate",
        description: `Set keyword ${request.criterionId} to ${request.status}`,
        body: {
          operations: [
            {
              update: {
                resourceName: criterionResource(cid, request.adGroupId, request.criterionId),
                status: request.status,
              },
              updateMask: "status",
            },
          ],
        },
      };

    case "negative_keyword":
      if (request.level === "CAMPAIGN") {
        return {
          endpoint: "campaignCriteria:mutate",
          description: `Add campaign negative "${request.text}" (${request.matchType})`,
          body: {
            operations: [
              {
                create: {
                  campaign: campaignResource(cid, request.campaignId ?? ""),
                  negative: true,
                  keyword: { text: request.text, matchType: request.matchType },
                },
              },
            ],
          },
        };
      }
      return {
        endpoint: "adGroupCriteria:mutate",
        description: `Add ad group negative "${request.text}" (${request.matchType})`,
        body: {
          operations: [
            {
              create: {
                adGroup: adGroupResource(cid, request.adGroupId ?? ""),
                negative: true,
                keyword: { text: request.text, matchType: request.matchType },
              },
            },
          ],
        },
      };

    case "keyword":
      return {
        endpoint: "adGroupCriteria:mutate",
        description: `Add keyword "${request.text}" (${request.matchType})`,
        body: {
          operations: [
            {
              create: {
                adGroup: adGroupResource(cid, request.adGroupId),
                status: "ENABLED",
                keyword: { text: request.text, matchType: request.matchType },
                ...(request.cpcBidMicros ? { cpcBidMicros: String(request.cpcBidMicros) } : {}),
                ...(request.finalUrl ? { finalUrls: [request.finalUrl] } : {}),
              },
            },
          ],
        },
      };

    case "ad_status":
      return {
        endpoint: "adGroupAds:mutate",
        description: `Set ad ${request.adId} to ${request.status}`,
        body: {
          operations: [
            {
              update: {
                resourceName: adGroupAdResource(cid, request.adGroupId, request.adId),
                status: request.status,
              },
              updateMask: "status",
            },
          ],
        },
      };

    case "responsive_search_ad":
      return {
        endpoint: "adGroupAds:mutate",
        description: `Create responsive search ad in ad group ${request.adGroupId}`,
        body: {
          operations: [
            {
              create: {
                adGroup: adGroupResource(cid, request.adGroupId),
                status: request.paused ? "PAUSED" : "ENABLED",
                ad: {
                  finalUrls: [request.finalUrl],
                  responsiveSearchAd: {
                    headlines: request.headlines.map((text) => ({ text })),
                    descriptions: request.descriptions.map((text) => ({ text })),
                    ...(request.path1 ? { path1: request.path1 } : {}),
                    ...(request.path2 ? { path2: request.path2 } : {}),
                  },
                },
              },
            },
          ],
        },
      };

    case "campaign_status":
      return {
        endpoint: "campaigns:mutate",
        description: `Set campaign ${request.campaignId} to ${request.status}`,
        body: {
          operations: [
            {
              update: {
                resourceName: campaignResource(cid, request.campaignId),
                status: request.status,
              },
              updateMask: "status",
            },
          ],
        },
      };
  }
}

export async function executeMutation(
  client: GoogleAdsClient,
  customerId: string,
  request: MutationRequest,
  options: { validateOnly?: boolean } = {},
): Promise<MutationResult> {
  const plan = planMutation(customerId, request);
  const body = { ...plan.body, validateOnly: Boolean(options.validateOnly) };

  const response = await client.mutate<MutateResponse>(plan.endpoint, body, { customerId });

  if (response.partialFailureError?.message) {
    return {
      success: false,
      resourceName: null,
      validatedOnly: Boolean(options.validateOnly),
      message: response.partialFailureError.message,
    };
  }

  log.info("mutation applied", {
    endpoint: plan.endpoint,
    validateOnly: Boolean(options.validateOnly),
    customerId,
  });

  return {
    success: true,
    resourceName: response.results?.[0]?.resourceName ?? null,
    validatedOnly: Boolean(options.validateOnly),
    message: plan.description,
  };
}
