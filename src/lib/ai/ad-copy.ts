import "server-only";

import { getAIProvider } from "@/lib/ai/provider";
import { adCopySchema, type AdCopy } from "@/lib/ai/schemas";
import { formatCurrency, formatPercent, formatRatio } from "@/lib/analytics/format";
import type { AdPerformance } from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

/**
 * Ad copy generation.
 *
 * Variants are drafts, never live ads: they are written to `AdVariant` and only reach
 * Google after someone publishes them through the normal action pipeline. The model
 * gets the winning ad's own language plus its measured performance, so proposals stay
 * recognisably the advertiser's voice instead of generic marketing filler.
 */

const log = createLogger("ai.ad-copy");

const SYSTEM_PROMPT = `You write Google responsive search ads for a performance marketing team.

Rules that cannot be broken:
- Headlines: maximum 30 characters INCLUDING spaces. Count them.
- Descriptions: maximum 90 characters INCLUDING spaces.
- Never invent offers, prices, discounts, guarantees, awards or delivery promises that are not present in the existing ad.
- Never use words the advertiser did not use about themselves ("best", "#1", "cheapest") unless the existing copy already claims it.
- Vary the angle between headlines: benefit, proof, service, location, action.
- Write in the same language as the existing ad.

You are given the current ad and how it performs. Improve the angles that are failing, keep the ones that work.`;

export type GeneratedVariant = {
  id: string;
  headlines: string[];
  descriptions: string[];
  rationale: string;
  generatedBy: string;
};

export async function generateAdVariant(input: {
  organizationId: string;
  accountId: string;
  ad: AdPerformance;
  currency: string;
  targetRoas: number | null;
}): Promise<GeneratedVariant> {
  const { ad } = input;

  if (ad.headlines.length === 0) {
    throw new AppError(
      "VALIDATION",
      "This ad has no headlines stored yet, so there is nothing to build a variant from.",
    );
  }

  const provider = getAIProvider();

  const performance = [
    `Impressions: ${ad.metrics.impressions}`,
    `Clicks: ${ad.metrics.clicks}`,
    `CTR: ${formatPercent(ad.metrics.ctr, { decimals: 2 })}`,
    `Spend: ${formatCurrency(ad.metrics.cost, input.currency)}`,
    `Conversions: ${ad.metrics.conversions}`,
    `Conversion rate: ${formatPercent(ad.metrics.conversionRate, { decimals: 2 })}`,
    `ROAS: ${formatRatio(ad.metrics.roas)}`,
    input.targetRoas ? `Target ROAS: ${formatRatio(input.targetRoas)}` : null,
    `Ad strength: ${ad.adStrength ?? "unknown"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data, usage } = await provider.structured<AdCopy>({
    system: SYSTEM_PROMPT,
    schemaName: "ad_copy",
    schema: adCopySchema,
    temperature: 0.7,
    maxTokens: 1200,
    user: `Campaign: ${ad.campaignName}
Ad group: ${ad.adGroupName}
Landing page: ${ad.finalUrl ?? "unknown"}

Current headlines:
${ad.headlines.map((headline) => `- ${headline}`).join("\n")}

Current descriptions:
${ad.descriptions.map((description) => `- ${description}`).join("\n")}

Performance over the selected period:
${performance}

Write one improved responsive search ad: 8 headlines and 3 descriptions, plus a short rationale explaining what you changed and why, referencing the performance above.`,
    fallback: () => deterministicVariant(ad),
  });

  // Length limits are contractual with Google; trim rather than let a publish fail.
  const headlines = data.headlines.map((headline) => headline.slice(0, 30)).slice(0, 15);
  const descriptions = data.descriptions.map((line) => line.slice(0, 90)).slice(0, 4);

  const variant = await prisma.adVariant.create({
    data: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      adGroupRowId: ad.adGroupRowId,
      sourceAdRowId: ad.id,
      headlines,
      descriptions,
      finalUrl: ad.finalUrl,
      rationale: data.rationale,
      generatedBy: provider.isLive ? provider.model : "deterministic",
      status: "DRAFT",
    },
    select: { id: true },
  });

  log.info("ad variant generated", {
    accountId: input.accountId,
    adId: ad.adId,
    live: provider.isLive,
    usage,
  });

  return {
    id: variant.id,
    headlines,
    descriptions,
    rationale: data.rationale,
    generatedBy: provider.isLive ? provider.model : "deterministic",
  };
}

/**
 * Recombination, not invention: without a model we reorder and lightly reshape the
 * advertiser's own headlines so the draft is still safe to publish.
 */
function deterministicVariant(ad: AdPerformance): AdCopy {
  const existing = ad.headlines.filter((headline) => headline.trim().length > 0);
  const base = existing.length > 0 ? existing : [ad.name];

  const angles = [
    base[0],
    base[1] ?? `${base[0]} — Get a Quote`,
    base[2] ?? "Request Availability",
    `${ad.adGroupName}`.slice(0, 30),
    "See Recent Work",
    "Book a Free Call",
    "Fast, Clear Pricing",
    "Trusted by Local Clients",
  ]
    .filter((headline): headline is string => Boolean(headline))
    .map((headline) => headline.slice(0, 30));

  const descriptions =
    ad.descriptions.length >= 2
      ? ad.descriptions.slice(0, 3).map((description) => description.slice(0, 90))
      : [
          "See availability, pricing and recent work in a couple of minutes.".slice(0, 90),
          "Straightforward quotes, no obligation. Get in touch today.".slice(0, 90),
        ];

  return {
    headlines: dedupe(angles).slice(0, 8),
    descriptions,
    rationale:
      "Generated without a language model: the existing headlines were re-ordered and combined with standard call-to-action angles. Review the wording before publishing.",
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export async function listAdVariants(organizationId: string, accountId: string) {
  return prisma.adVariant.findMany({
    where: { organizationId, accountId, status: { in: ["DRAFT", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      headlines: true,
      descriptions: true,
      rationale: true,
      status: true,
      generatedBy: true,
      createdAt: true,
      finalUrl: true,
      sourceAd: { select: { adId: true, headlines: true } },
      adGroup: { select: { name: true, adGroupId: true } },
    },
  });
}
