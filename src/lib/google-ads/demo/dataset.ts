import { enumerateDays, parseDateKey } from "@/lib/analytics/date-range";
import type {
  AccessibleCustomer,
  DateWindow,
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
 * Deterministic demo account.
 *
 * The dataset is generated bottom-up from keyword-level day rows and then aggregated,
 * so every table in the product foots exactly the way a real account would. It is
 * seeded from the account id, which means the same demo account always tells the same
 * story: one budget-limited winner, one keyword burning money, one wasteful search
 * term, and a recent conversion drop for anomaly detection to catch.
 */

const MICROS = 1_000_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type KeywordSpec = {
  criterionId: string;
  text: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  /** Average daily impressions before seasonality and noise. */
  impressions: number;
  ctr: number;
  cpc: number;
  cvr: number;
  valuePerConversion: number;
  qualityScore: number;
  searchTerms: Array<{ text: string; share: number; cvrMultiplier: number }>;
};

type AdGroupSpec = {
  adGroupId: string;
  name: string;
  cpcBid: number;
  keywords: KeywordSpec[];
  ads: Array<{ adId: string; headlines: string[]; descriptions: string[]; weight: number; strength: string }>;
};

type CampaignSpec = {
  campaignId: string;
  name: string;
  budget: number;
  biddingStrategy: string;
  targetRoas?: number;
  targetCpa?: number;
  status: "ENABLED" | "PAUSED";
  adGroups: AdGroupSpec[];
};

const FINAL_URL = "https://studionova.example/wedding-films";

const CAMPAIGNS: CampaignSpec[] = [
  {
    campaignId: "20100001",
    name: "Search — Brand",
    budget: 15,
    biddingStrategy: "TARGET_SPEND",
    status: "ENABLED",
    adGroups: [
      {
        adGroupId: "30100001",
        name: "Brand — Exact",
        cpcBid: 0.9,
        ads: [
          {
            adId: "40100001",
            headlines: ["Studio Nova Wedding Films", "Official Site", "Book a Free Call"],
            descriptions: ["Cinematic wedding films shot across the Netherlands."],
            weight: 1,
            strength: "EXCELLENT",
          },
        ],
        keywords: [
          {
            criterionId: "50100001",
            text: "studio nova wedding films",
            matchType: "EXACT",
            impressions: 62,
            ctr: 0.23,
            cpc: 0.42,
            cvr: 0.17,
            valuePerConversion: 210,
            qualityScore: 10,
            searchTerms: [
              { text: "studio nova wedding films", share: 0.62, cvrMultiplier: 1.1 },
              { text: "studio nova videographer", share: 0.24, cvrMultiplier: 0.9 },
              { text: "studionova wedding", share: 0.14, cvrMultiplier: 0.8 },
            ],
          },
        ],
      },
    ],
  },
  {
    campaignId: "20100002",
    name: "Search — Wedding Videography",
    budget: 50,
    biddingStrategy: "MAXIMIZE_CONVERSION_VALUE",
    targetRoas: 6,
    status: "ENABLED",
    adGroups: [
      {
        adGroupId: "30100002",
        name: "Wedding — Friesland",
        cpcBid: 1.8,
        ads: [
          {
            adId: "40100002",
            headlines: ["Wedding Videographer Friesland", "Cinematic Wedding Films", "View Our Films"],
            descriptions: ["Natural, cinematic wedding films in Friesland. Book a free call."],
            weight: 0.62,
            strength: "GOOD",
          },
          {
            adId: "40100003",
            headlines: ["Trouwvideograaf Friesland", "Bekijk Onze Films", "Vraag Prijzen Aan"],
            descriptions: ["Sfeervolle trouwfilms in heel Friesland. Vrijblijvend kennismaken."],
            weight: 0.38,
            strength: "AVERAGE",
          },
        ],
        keywords: [
          {
            criterionId: "50100002",
            text: "wedding videographer friesland",
            matchType: "EXACT",
            impressions: 96,
            ctr: 0.121,
            cpc: 1.52,
            cvr: 0.101,
            valuePerConversion: 178,
            qualityScore: 9,
            searchTerms: [
              { text: "wedding videographer friesland", share: 0.48, cvrMultiplier: 1.25 },
              { text: "wedding videographer leeuwarden", share: 0.22, cvrMultiplier: 1.1 },
              { text: "wedding videographer sneek", share: 0.16, cvrMultiplier: 0.95 },
              { text: "wedding videographer jobs friesland", share: 0.14, cvrMultiplier: 0 },
            ],
          },
          {
            criterionId: "50100003",
            text: "bruidsvideograaf friesland",
            matchType: "PHRASE",
            impressions: 124,
            ctr: 0.102,
            cpc: 1.33,
            cvr: 0.088,
            valuePerConversion: 172,
            qualityScore: 8,
            searchTerms: [
              { text: "bruidsvideograaf friesland", share: 0.44, cvrMultiplier: 1.2 },
              { text: "bruidsvideograaf leeuwarden", share: 0.26, cvrMultiplier: 1.05 },
              { text: "goedkope bruidsvideograaf", share: 0.18, cvrMultiplier: 0.15 },
              { text: "bruidsvideograaf worden", share: 0.12, cvrMultiplier: 0 },
            ],
          },
        ],
      },
      {
        adGroupId: "30100003",
        name: "Wedding — General",
        cpcBid: 2.1,
        ads: [
          {
            adId: "40100004",
            headlines: ["Wedding Videographer", "Cinematic Wedding Films", "Free Consultation"],
            descriptions: ["Award-winning wedding films. Transparent pricing, no packages you don't need."],
            weight: 1,
            strength: "AVERAGE",
          },
        ],
        keywords: [
          {
            criterionId: "50100004",
            text: "wedding videographer",
            matchType: "PHRASE",
            impressions: 214,
            ctr: 0.058,
            cpc: 1.86,
            cvr: 0.041,
            valuePerConversion: 168,
            qualityScore: 6,
            searchTerms: [
              { text: "wedding videographer near me", share: 0.31, cvrMultiplier: 1.15 },
              { text: "cheap wedding videographer", share: 0.24, cvrMultiplier: 0 },
              { text: "wedding videographer prices", share: 0.2, cvrMultiplier: 0.7 },
              { text: "how to edit a wedding video", share: 0.15, cvrMultiplier: 0 },
              { text: "best wedding videographer amsterdam", share: 0.1, cvrMultiplier: 1.3 },
            ],
          },
          {
            criterionId: "50100005",
            text: "cinematic wedding film",
            matchType: "PHRASE",
            impressions: 88,
            ctr: 0.079,
            cpc: 1.71,
            cvr: 0.062,
            valuePerConversion: 205,
            qualityScore: 8,
            searchTerms: [
              { text: "cinematic wedding film", share: 0.52, cvrMultiplier: 1.2 },
              { text: "cinematic wedding video style", share: 0.28, cvrMultiplier: 0.85 },
              { text: "cinematic wedding film examples", share: 0.2, cvrMultiplier: 0.3 },
            ],
          },
        ],
      },
    ],
  },
  {
    campaignId: "20100003",
    name: "Search — Corporate Video",
    budget: 35,
    biddingStrategy: "MAXIMIZE_CONVERSIONS",
    targetCpa: 70,
    status: "ENABLED",
    adGroups: [
      {
        adGroupId: "30100004",
        name: "Corporate — Promo",
        cpcBid: 3.4,
        ads: [
          {
            adId: "40100005",
            headlines: ["Corporate Video Production", "From Concept To Delivery", "Request A Quote"],
            descriptions: ["Brand films, product videos and event coverage for growing companies."],
            weight: 0.55,
            strength: "AVERAGE",
          },
          {
            adId: "40100006",
            headlines: ["Bedrijfsvideo Laten Maken", "Vaste Prijzen", "Plan Een Kennismaking"],
            descriptions: ["Professionele bedrijfsvideo's met een vast tarief en snelle oplevering."],
            weight: 0.45,
            strength: "GOOD",
          },
        ],
        keywords: [
          {
            criterionId: "50100006",
            text: "corporate video production",
            matchType: "PHRASE",
            impressions: 168,
            ctr: 0.052,
            cpc: 3.15,
            cvr: 0.026,
            valuePerConversion: 240,
            qualityScore: 5,
            searchTerms: [
              { text: "corporate video production company", share: 0.34, cvrMultiplier: 1.1 },
              { text: "corporate video production cost", share: 0.26, cvrMultiplier: 0.6 },
              { text: "corporate video production software", share: 0.22, cvrMultiplier: 0 },
              { text: "corporate video production internship", share: 0.18, cvrMultiplier: 0 },
            ],
          },
          {
            criterionId: "50100007",
            text: "bedrijfsvideo laten maken",
            matchType: "PHRASE",
            impressions: 104,
            ctr: 0.073,
            cpc: 2.42,
            cvr: 0.048,
            valuePerConversion: 265,
            qualityScore: 8,
            searchTerms: [
              { text: "bedrijfsvideo laten maken", share: 0.56, cvrMultiplier: 1.15 },
              { text: "bedrijfsvideo laten maken kosten", share: 0.28, cvrMultiplier: 0.7 },
              { text: "bedrijfsvideo zelf maken", share: 0.16, cvrMultiplier: 0 },
            ],
          },
        ],
      },
    ],
  },
  {
    campaignId: "20100004",
    name: "Search — Video Editing",
    budget: 20,
    biddingStrategy: "MAXIMIZE_CLICKS",
    status: "ENABLED",
    adGroups: [
      {
        adGroupId: "30100005",
        name: "Editing — Services",
        cpcBid: 1.3,
        ads: [
          {
            adId: "40100007",
            headlines: ["Wedding Video Editing", "Send Us Your Footage", "48h Turnaround"],
            descriptions: ["Professional editing for your wedding footage. Colour grading included."],
            weight: 1,
            strength: "POOR",
          },
        ],
        keywords: [
          {
            criterionId: "50100008",
            text: "wedding video editing",
            matchType: "PHRASE",
            impressions: 92,
            ctr: 0.049,
            cpc: 1.09,
            cvr: 0,
            valuePerConversion: 0,
            qualityScore: 4,
            searchTerms: [
              { text: "wedding video editing software", share: 0.38, cvrMultiplier: 0 },
              { text: "wedding video editing free", share: 0.27, cvrMultiplier: 0 },
              { text: "wedding video editing service", share: 0.21, cvrMultiplier: 0 },
              { text: "how to edit wedding video in premiere", share: 0.14, cvrMultiplier: 0 },
            ],
          },
          {
            criterionId: "50100009",
            text: "video editor for wedding",
            matchType: "PHRASE",
            impressions: 58,
            ctr: 0.044,
            cpc: 1.02,
            cvr: 0.012,
            valuePerConversion: 95,
            qualityScore: 5,
            searchTerms: [
              { text: "video editor for wedding", share: 0.6, cvrMultiplier: 1 },
              { text: "hire video editor wedding", share: 0.4, cvrMultiplier: 0.9 },
            ],
          },
        ],
      },
    ],
  },
];

export const DEMO_CUSTOMER_ID = "8123456790";

export function demoAccessibleAccounts(): AccessibleCustomer[] {
  return [
    {
      customerId: DEMO_CUSTOMER_ID,
      descriptiveName: "Demo Account — Studio Nova",
      currencyCode: "EUR",
      timeZone: "Europe/Amsterdam",
      isManager: false,
      isTestAccount: true,
      loginCustomerId: null,
      status: "ENABLED",
    },
  ];
}

/** Weekend-heavy demand for wedding work, quiet weekends for corporate. */
function seasonality(dateKey: string, campaignId: string): number {
  const day = parseDateKey(dateKey).getUTCDay();
  const isWeekend = day === 0 || day === 6;
  if (campaignId === "20100003") return isWeekend ? 0.55 : 1.12;
  if (campaignId === "20100002") return isWeekend ? 1.22 : 0.94;
  return isWeekend ? 0.85 : 1.05;
}

/** Slow upward trend so period-over-period comparisons have something to show. */
function trend(index: number, total: number): number {
  const progress = total <= 1 ? 1 : index / (total - 1);
  return 0.82 + progress * 0.36;
}

type KeywordDay = {
  campaignId: string;
  adGroupId: string;
  criterionId: string;
  date: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
};

function generateKeywordDays(window: DateWindow, seed: number): KeywordDay[] {
  const random = mulberry32(seed);
  const days = enumerateDays(window);
  const rows: KeywordDay[] = [];
  const lastDay = days[days.length - 1];

  for (const [index, date] of days.entries()) {
    const daysFromEnd = lastDay ? Math.round((parseDateKey(lastDay).getTime() - parseDateKey(date).getTime()) / 86_400_000) : 0;

    for (const campaign of CAMPAIGNS) {
      if (campaign.status !== "ENABLED") continue;

      for (const adGroup of campaign.adGroups) {
        for (const keyword of adGroup.keywords) {
          const noise = 0.78 + random() * 0.44;
          const factor = seasonality(date, campaign.campaignId) * trend(index, days.length) * noise;

          // Story beat: corporate conversions collapse over the last four days.
          const conversionShock =
            campaign.campaignId === "20100003" && daysFromEnd <= 3 ? 0.28 : 1;
          // Story beat: the editing campaign starts overspending in the final week.
          const spendShock =
            campaign.campaignId === "20100004" && daysFromEnd <= 5 ? 2.4 : 1;

          const impressions = Math.max(0, Math.round(keyword.impressions * factor * spendShock));
          const clicks = Math.max(0, Math.round(impressions * keyword.ctr * (0.9 + random() * 0.2)));
          const costMicros = Math.round(clicks * keyword.cpc * (0.92 + random() * 0.16) * MICROS);

          const expectedConversions = clicks * keyword.cvr * conversionShock;
          // Conversions arrive in whole units; fractional expectation becomes probability.
          const whole = Math.floor(expectedConversions);
          const remainder = expectedConversions - whole;
          const conversions = whole + (random() < remainder ? 1 : 0);
          const conversionValueMicros = Math.round(
            conversions * keyword.valuePerConversion * (0.85 + random() * 0.3) * MICROS,
          );

          if (impressions === 0) continue;

          rows.push({
            campaignId: campaign.campaignId,
            adGroupId: adGroup.adGroupId,
            criterionId: keyword.criterionId,
            date,
            impressions,
            clicks,
            costMicros,
            conversions,
            conversionValueMicros,
          });
        }
      }
    }
  }

  return rows;
}

type Aggregate = {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
};

function emptyAggregate(): Aggregate {
  return { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionValueMicros: 0 };
}

function accumulate(target: Aggregate, row: Aggregate): void {
  target.impressions += row.impressions;
  target.clicks += row.clicks;
  target.costMicros += row.costMicros;
  target.conversions += row.conversions;
  target.conversionValueMicros += row.conversionValueMicros;
}

function toDailyMetric(
  level: NormalizedDailyMetric["level"],
  entityId: string,
  date: string,
  aggregate: Aggregate,
  extras: Partial<NormalizedDailyMetric> = {},
): NormalizedDailyMetric {
  return {
    level,
    entityId,
    date,
    impressions: aggregate.impressions,
    clicks: aggregate.clicks,
    costMicros: aggregate.costMicros,
    conversions: aggregate.conversions,
    conversionValueMicros: aggregate.conversionValueMicros,
    allConversions: aggregate.conversions,
    allConversionValueMicros: aggregate.conversionValueMicros,
    interactions: aggregate.clicks,
    videoViews: 0,
    searchImpressionShare: null,
    searchBudgetLostImprShare: null,
    searchRankLostImprShare: null,
    topImpressionPercentage: null,
    ...extras,
  };
}

export type DemoSnapshot = {
  campaigns: NormalizedCampaign[];
  adGroups: NormalizedAdGroup[];
  keywords: NormalizedKeyword[];
  ads: NormalizedAd[];
  searchTerms: NormalizedSearchTerm[];
  conversions: NormalizedConversionAction[];
  dailyMetrics: NormalizedDailyMetric[];
  segments: NormalizedSegment[];
};

export function buildDemoSnapshot(accountKey: string, window: DateWindow): DemoSnapshot {
  const seed = seedFrom(`${accountKey}:${window.start}:${window.end}`);
  const keywordDays = generateKeywordDays(window, seed);

  const campaigns: NormalizedCampaign[] = CAMPAIGNS.map((campaign) => ({
    campaignId: campaign.campaignId,
    name: campaign.name,
    status: campaign.status,
    advertisingChannel: "SEARCH",
    biddingStrategyType: campaign.biddingStrategy,
    budgetId: `6${campaign.campaignId}`,
    budgetName: `${campaign.name} budget`,
    budgetAmountMicros: campaign.budget * MICROS,
    budgetIsShared: false,
    budgetDeliveryMethod: "STANDARD",
    targetRoas: campaign.targetRoas ?? null,
    targetCpaMicros: campaign.targetCpa ? campaign.targetCpa * MICROS : null,
    startDate: null,
    endDate: null,
    optimizationScore: 0.72,
  }));

  const adGroups: NormalizedAdGroup[] = CAMPAIGNS.flatMap((campaign) =>
    campaign.adGroups.map((adGroup) => ({
      adGroupId: adGroup.adGroupId,
      campaignId: campaign.campaignId,
      name: adGroup.name,
      status: "ENABLED" as const,
      type: "SEARCH_STANDARD",
      cpcBidMicros: Math.round(adGroup.cpcBid * MICROS),
      targetRoas: null,
      targetCpaMicros: null,
    })),
  );

  const keywords: NormalizedKeyword[] = CAMPAIGNS.flatMap((campaign) =>
    campaign.adGroups.flatMap((adGroup) =>
      adGroup.keywords.map((keyword) => ({
        criterionId: keyword.criterionId,
        adGroupId: adGroup.adGroupId,
        campaignId: campaign.campaignId,
        text: keyword.text,
        matchType: keyword.matchType,
        status: "ENABLED" as const,
        isNegative: false,
        cpcBidMicros: Math.round(adGroup.cpcBid * MICROS),
        effectiveCpcBidMicros: Math.round(keyword.cpc * 1.15 * MICROS),
        qualityScore: keyword.qualityScore,
        expectedCtr: keyword.qualityScore >= 8 ? "ABOVE_AVERAGE" : "AVERAGE",
        adRelevance: keyword.qualityScore >= 7 ? "ABOVE_AVERAGE" : "AVERAGE",
        landingPageExperience: keyword.qualityScore >= 6 ? "AVERAGE" : "BELOW_AVERAGE",
        firstPageCpcMicros: Math.round(keyword.cpc * 0.6 * MICROS),
        topOfPageCpcMicros: Math.round(keyword.cpc * 1.4 * MICROS),
        finalUrl: FINAL_URL,
      })),
    ),
  );

  const ads: NormalizedAd[] = CAMPAIGNS.flatMap((campaign) =>
    campaign.adGroups.flatMap((adGroup) =>
      adGroup.ads.map((ad) => ({
        adId: ad.adId,
        adGroupId: adGroup.adGroupId,
        campaignId: campaign.campaignId,
        type: "RESPONSIVE_SEARCH_AD",
        status: "ENABLED" as const,
        adStrength: ad.strength,
        headlines: ad.headlines,
        descriptions: ad.descriptions,
        finalUrls: [FINAL_URL],
        path1: "wedding",
        path2: "films",
      })),
    ),
  );

  // ---- aggregate keyword days upward -------------------------------------
  const keywordDaily = new Map<string, Aggregate>();
  const adGroupDaily = new Map<string, Aggregate>();
  const campaignDaily = new Map<string, Aggregate>();
  const accountDaily = new Map<string, Aggregate>();
  const keywordTotals = new Map<string, Aggregate>();

  for (const row of keywordDays) {
    const keywordKey = `${row.criterionId}|${row.date}|${row.adGroupId}|${row.campaignId}`;
    const adGroupKey = `${row.adGroupId}|${row.date}|${row.campaignId}`;
    const campaignKey = `${row.campaignId}|${row.date}`;

    for (const [map, key] of [
      [keywordDaily, keywordKey],
      [adGroupDaily, adGroupKey],
      [campaignDaily, campaignKey],
      [accountDaily, row.date],
      [keywordTotals, row.criterionId],
    ] as const) {
      const current = map.get(key) ?? emptyAggregate();
      accumulate(current, row);
      map.set(key, current);
    }
  }

  const dailyMetrics: NormalizedDailyMetric[] = [];

  for (const [key, aggregate] of keywordDaily) {
    const [criterionId, date, adGroupId, campaignId] = key.split("|");
    dailyMetrics.push(
      toDailyMetric("KEYWORD", criterionId, date, aggregate, { campaignId, adGroupId, criterionId }),
    );
  }

  for (const [key, aggregate] of adGroupDaily) {
    const [adGroupId, date, campaignId] = key.split("|");
    dailyMetrics.push(toDailyMetric("AD_GROUP", adGroupId, date, aggregate, { campaignId, adGroupId }));
  }

  const budgetById = new Map(CAMPAIGNS.map((campaign) => [campaign.campaignId, campaign.budget]));

  for (const [key, aggregate] of campaignDaily) {
    const [campaignId, date] = key.split("|");
    const budget = budgetById.get(campaignId) ?? 50;
    const spend = aggregate.costMicros / MICROS;
    // Budget-limited campaigns lose impression share to budget, not to rank.
    const budgetPressure = Math.max(0, Math.min(0.45, (spend / budget - 0.82) * 0.9));

    dailyMetrics.push(
      toDailyMetric("CAMPAIGN", campaignId, date, aggregate, {
        campaignId,
        searchImpressionShare: Math.max(0.22, 0.86 - budgetPressure * 1.4),
        searchBudgetLostImprShare: budgetPressure,
        searchRankLostImprShare: Math.max(0.04, 0.14 - budgetPressure * 0.2),
        topImpressionPercentage: 0.58,
      }),
    );
  }

  for (const [date, aggregate] of accountDaily) {
    dailyMetrics.push(
      toDailyMetric("ACCOUNT", DEMO_CUSTOMER_ID, date, aggregate, {
        searchImpressionShare: 0.61,
        searchBudgetLostImprShare: 0.19,
        searchRankLostImprShare: 0.2,
        topImpressionPercentage: 0.55,
      }),
    );
  }

  // ---- ads: split ad group traffic by weight ------------------------------
  for (const campaign of CAMPAIGNS) {
    for (const adGroup of campaign.adGroups) {
      for (const [key, aggregate] of adGroupDaily) {
        const [adGroupId, date] = key.split("|");
        if (adGroupId !== adGroup.adGroupId) continue;

        for (const ad of adGroup.ads) {
          dailyMetrics.push(
            toDailyMetric(
              "AD",
              ad.adId,
              date,
              {
                impressions: Math.round(aggregate.impressions * ad.weight),
                clicks: Math.round(aggregate.clicks * ad.weight),
                costMicros: Math.round(aggregate.costMicros * ad.weight),
                conversions: Math.round(aggregate.conversions * ad.weight * 100) / 100,
                conversionValueMicros: Math.round(aggregate.conversionValueMicros * ad.weight),
              },
              { campaignId: campaign.campaignId, adGroupId: adGroup.adGroupId, adId: ad.adId },
            ),
          );
        }
      }
    }
  }

  // ---- search terms: shares of each keyword's window totals ---------------
  const searchTerms: NormalizedSearchTerm[] = [];
  for (const campaign of CAMPAIGNS) {
    for (const adGroup of campaign.adGroups) {
      for (const keyword of adGroup.keywords) {
        const totals = keywordTotals.get(keyword.criterionId);
        if (!totals) continue;

        for (const term of keyword.searchTerms) {
          const conversions = Math.round(totals.conversions * term.share * term.cvrMultiplier);
          searchTerms.push({
            text: term.text,
            adGroupId: adGroup.adGroupId,
            campaignId: campaign.campaignId,
            matchType: keyword.matchType,
            status: term.text === keyword.text ? "ADDED" : "NONE",
            triggeredKeyword: keyword.text,
            impressions: Math.round(totals.impressions * term.share),
            clicks: Math.round(totals.clicks * term.share),
            costMicros: Math.round(totals.costMicros * term.share),
            conversions,
            conversionValueMicros: Math.round(
              conversions * keyword.valuePerConversion * MICROS,
            ),
          });
        }
      }
    }
  }

  // ---- segments -----------------------------------------------------------
  const deviceSplit: Array<[string, string, number, number]> = [
    ["MOBILE", "Mobile", 0.57, 0.78],
    ["DESKTOP", "Desktop", 0.36, 1.42],
    ["TABLET", "Tablet", 0.07, 0.6],
  ];
  const hourWeights = [
    0.008, 0.005, 0.004, 0.003, 0.004, 0.008, 0.018, 0.032, 0.052, 0.068, 0.075, 0.072, 0.065,
    0.068, 0.071, 0.069, 0.066, 0.062, 0.058, 0.055, 0.048, 0.038, 0.026, 0.015,
  ];
  const locationSplit: Array<[string, string, number, number]> = [
    ["2528", "Netherlands", 0.78, 1.12],
    ["2056", "Belgium", 0.12, 0.82],
    ["2276", "Germany", 0.06, 0.55],
    ["2826", "United Kingdom", 0.04, 0.4],
  ];
  const dayLabels = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

  const segments: NormalizedSegment[] = [];

  for (const [key, aggregate] of campaignDaily) {
    const [campaignId, date] = key.split("|");
    const base = { scope: "CAMPAIGN" as const, scopeId: campaignId, date };

    for (const [segmentKey, segmentLabel, share, conversionBias] of deviceSplit) {
      segments.push({
        ...base,
        segmentType: "DEVICE",
        segmentKey,
        segmentLabel,
        impressions: Math.round(aggregate.impressions * share),
        clicks: Math.round(aggregate.clicks * share),
        costMicros: Math.round(aggregate.costMicros * share),
        conversions: Math.round(aggregate.conversions * share * conversionBias * 100) / 100,
        conversionValueMicros: Math.round(aggregate.conversionValueMicros * share * conversionBias),
      });
    }

    for (const [segmentKey, segmentLabel, share, conversionBias] of locationSplit) {
      segments.push({
        ...base,
        segmentType: "LOCATION",
        segmentKey,
        segmentLabel,
        impressions: Math.round(aggregate.impressions * share),
        clicks: Math.round(aggregate.clicks * share),
        costMicros: Math.round(aggregate.costMicros * share),
        conversions: Math.round(aggregate.conversions * share * conversionBias * 100) / 100,
        conversionValueMicros: Math.round(aggregate.conversionValueMicros * share * conversionBias),
      });
    }

    for (const [hour, weight] of hourWeights.entries()) {
      if (aggregate.clicks * weight < 0.5) continue;
      segments.push({
        ...base,
        segmentType: "HOUR_OF_DAY",
        segmentKey: String(hour).padStart(2, "0"),
        segmentLabel: `${String(hour).padStart(2, "0")}:00`,
        impressions: Math.round(aggregate.impressions * weight),
        clicks: Math.round(aggregate.clicks * weight),
        costMicros: Math.round(aggregate.costMicros * weight),
        conversions: Math.round(aggregate.conversions * weight * 100) / 100,
        conversionValueMicros: Math.round(aggregate.conversionValueMicros * weight),
      });
    }

    const dayKey = dayLabels[parseDateKey(date).getUTCDay()];
    segments.push({
      ...base,
      segmentType: "DAY_OF_WEEK",
      segmentKey: dayKey,
      segmentLabel: dayKey.charAt(0) + dayKey.slice(1).toLowerCase(),
      impressions: aggregate.impressions,
      clicks: aggregate.clicks,
      costMicros: aggregate.costMicros,
      conversions: aggregate.conversions,
      conversionValueMicros: aggregate.conversionValueMicros,
    });
  }

  // ---- conversion actions -------------------------------------------------
  const accountTotals = emptyAggregate();
  for (const aggregate of accountDaily.values()) accumulate(accountTotals, aggregate);

  const conversions: NormalizedConversionAction[] = [
    {
      conversionActionId: "70100001",
      name: "Contact form submitted",
      category: "SUBMIT_LEAD_FORM",
      type: "WEBPAGE",
      status: "ENABLED",
      countingType: "ONE_PER_CLICK",
      includeInConversionsMetric: true,
      primaryForGoal: true,
      valuePerConversionMicros: 175 * MICROS,
      conversions: Math.round(accountTotals.conversions * 0.62),
      conversionValueMicros: Math.round(accountTotals.conversionValueMicros * 0.62),
    },
    {
      conversionActionId: "70100002",
      name: "Call from ads (60s+)",
      category: "PHONE_CALL_LEAD",
      type: "AD_CALL",
      status: "ENABLED",
      countingType: "ONE_PER_CLICK",
      includeInConversionsMetric: true,
      primaryForGoal: true,
      valuePerConversionMicros: 210 * MICROS,
      conversions: Math.round(accountTotals.conversions * 0.28),
      conversionValueMicros: Math.round(accountTotals.conversionValueMicros * 0.28),
    },
    {
      conversionActionId: "70100003",
      name: "Pricing page view",
      category: "PAGE_VIEW",
      type: "WEBPAGE",
      status: "ENABLED",
      countingType: "ONE_PER_CLICK",
      includeInConversionsMetric: false,
      primaryForGoal: false,
      valuePerConversionMicros: null,
      conversions: Math.round(accountTotals.conversions * 2.4),
      conversionValueMicros: 0,
    },
  ];

  return { campaigns, adGroups, keywords, ads, searchTerms, conversions, dailyMetrics, segments };
}
