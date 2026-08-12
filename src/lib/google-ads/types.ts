/**
 * Normalized Google Ads domain types.
 *
 * Everything the rest of the application consumes is expressed in these shapes. Both
 * the live REST provider and the demo provider produce them, so the sync pipeline,
 * optimizer and UI have no idea which one is behind the interface.
 */

export type AdsEntityStatus = "ENABLED" | "PAUSED" | "REMOVED" | "UNKNOWN";
export type AdsMatchType = "EXACT" | "PHRASE" | "BROAD" | "UNKNOWN";

export type AccessibleCustomer = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isManager: boolean;
  isTestAccount: boolean;
  /** Manager account required as login-customer-id when querying this customer. */
  loginCustomerId?: string | null;
  status?: string;
};

export type NormalizedCampaign = {
  campaignId: string;
  name: string;
  status: AdsEntityStatus;
  advertisingChannel: string;
  biddingStrategyType: string | null;
  budgetId: string | null;
  budgetName: string | null;
  budgetAmountMicros: number;
  budgetIsShared: boolean;
  budgetDeliveryMethod: string | null;
  targetRoas: number | null;
  targetCpaMicros: number | null;
  startDate: string | null;
  endDate: string | null;
  optimizationScore: number | null;
};

export type NormalizedAdGroup = {
  adGroupId: string;
  campaignId: string;
  name: string;
  status: AdsEntityStatus;
  type: string | null;
  cpcBidMicros: number | null;
  targetRoas: number | null;
  targetCpaMicros: number | null;
};

export type NormalizedKeyword = {
  criterionId: string;
  adGroupId: string;
  campaignId: string;
  text: string;
  matchType: AdsMatchType;
  status: AdsEntityStatus;
  isNegative: boolean;
  cpcBidMicros: number | null;
  effectiveCpcBidMicros: number | null;
  qualityScore: number | null;
  expectedCtr: string | null;
  adRelevance: string | null;
  landingPageExperience: string | null;
  firstPageCpcMicros: number | null;
  topOfPageCpcMicros: number | null;
  finalUrl: string | null;
};

export type NormalizedAd = {
  adId: string;
  adGroupId: string;
  campaignId: string;
  type: string;
  status: AdsEntityStatus;
  adStrength: string | null;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  path1: string | null;
  path2: string | null;
};

export type NormalizedSearchTerm = {
  text: string;
  adGroupId: string | null;
  campaignId: string | null;
  matchType: AdsMatchType;
  status: "NONE" | "ADDED" | "EXCLUDED" | "ADDED_EXCLUDED" | "UNKNOWN";
  triggeredKeyword: string | null;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
};

export type NormalizedConversionAction = {
  conversionActionId: string;
  name: string;
  category: string | null;
  type: string | null;
  status: string | null;
  countingType: string | null;
  includeInConversionsMetric: boolean;
  primaryForGoal: boolean;
  valuePerConversionMicros: number | null;
  conversions: number;
  conversionValueMicros: number;
};

export type MetricLevelName = "ACCOUNT" | "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "AD";

export type NormalizedDailyMetric = {
  level: MetricLevelName;
  /** Google id of the entity — customer id at ACCOUNT level. */
  entityId: string;
  campaignId?: string | null;
  adGroupId?: string | null;
  criterionId?: string | null;
  adId?: string | null;
  date: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
  allConversions: number;
  allConversionValueMicros: number;
  interactions: number;
  videoViews: number;
  searchImpressionShare: number | null;
  searchBudgetLostImprShare: number | null;
  searchRankLostImprShare: number | null;
  topImpressionPercentage: number | null;
};

export type SegmentTypeName = "DEVICE" | "LOCATION" | "HOUR_OF_DAY" | "DAY_OF_WEEK" | "NETWORK";

export type NormalizedSegment = {
  scope: "ACCOUNT" | "CAMPAIGN";
  scopeId: string;
  segmentType: SegmentTypeName;
  segmentKey: string;
  segmentLabel: string;
  date: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
};

export type GoogleRecommendation = {
  resourceName: string;
  type: string;
  description: string | null;
  impact: {
    baseCost: number | null;
    potentialCost: number | null;
    baseConversions: number | null;
    potentialConversions: number | null;
  } | null;
};

export type DateWindow = { start: string; end: string };

// ---------------------------------------------------------------------------
// Mutations — the only operations that write to Google Ads
// ---------------------------------------------------------------------------

export type BudgetUpdate = {
  kind: "campaign_budget";
  campaignId: string;
  budgetId: string;
  amountMicros: number;
};

export type KeywordBidUpdate = {
  kind: "keyword_bid";
  adGroupId: string;
  criterionId: string;
  cpcBidMicros: number;
};

export type KeywordStatusUpdate = {
  kind: "keyword_status";
  adGroupId: string;
  criterionId: string;
  status: "ENABLED" | "PAUSED";
};

export type NegativeKeywordCreate = {
  kind: "negative_keyword";
  level: "CAMPAIGN" | "AD_GROUP";
  campaignId?: string;
  adGroupId?: string;
  text: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
};

export type KeywordCreate = {
  kind: "keyword";
  adGroupId: string;
  text: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  cpcBidMicros?: number | null;
  finalUrl?: string | null;
};

export type AdStatusUpdate = {
  kind: "ad_status";
  adGroupId: string;
  adId: string;
  status: "ENABLED" | "PAUSED";
};

export type ResponsiveSearchAdCreate = {
  kind: "responsive_search_ad";
  adGroupId: string;
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  path1?: string | null;
  path2?: string | null;
  paused: boolean;
};

export type CampaignStatusUpdate = {
  kind: "campaign_status";
  campaignId: string;
  status: "ENABLED" | "PAUSED";
};

export type MutationRequest =
  | BudgetUpdate
  | KeywordBidUpdate
  | KeywordStatusUpdate
  | NegativeKeywordCreate
  | KeywordCreate
  | AdStatusUpdate
  | ResponsiveSearchAdCreate
  | CampaignStatusUpdate;

export type MutationResult = {
  success: boolean;
  resourceName: string | null;
  /** Populated when the mutation ran with validateOnly. */
  validatedOnly: boolean;
  message: string;
};
