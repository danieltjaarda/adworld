"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/components/forms/form-state";
import { generateAdVariant } from "@/lib/ai/ad-copy";
import { requireAuthWith } from "@/lib/auth/context";
import { assertWithinUsage, assertWriteEnabled } from "@/lib/billing/limits";
import { getAdPerformance, getAccountSettings, profitConfigFrom } from "@/lib/analytics/queries";
import { resolveRange } from "@/lib/analytics/date-range";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { applyManualChange } from "@/lib/optimization/manual";

/**
 * Ad optimizer write surface: draft a variant with the model, publish an approved
 * draft as a real responsive search ad, or pause an underperformer.
 */

const log = createLogger("ads.actions");

export async function generateVariantAction(adRowId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");
    await assertWriteEnabled(context.organization.id);
    await assertWithinUsage(context.organization.id, "ai_actions");

    const ad = await prisma.ad.findFirst({
      where: { id: adRowId, organizationId: context.organization.id },
      select: { id: true, accountId: true, account: { select: { timeZone: true, currencyCode: true } } },
    });
    if (!ad) throw errors.notFound("That ad is no longer available.");

    const scope = { organizationId: context.organization.id, accountId: ad.accountId };
    const settings = await getAccountSettings(scope);
    const range = resolveRange("last_30", ad.account.timeZone);

    const performance = await getAdPerformance(scope, range, profitConfigFrom(settings));
    const target = performance.find((entry) => entry.id === adRowId);
    if (!target) throw errors.notFound("That ad has no performance data to work from.");

    const variant = await generateAdVariant({
      organizationId: context.organization.id,
      accountId: ad.accountId,
      ad: target,
      currency: ad.account.currencyCode,
      targetRoas: settings.targetRoas,
    });

    revalidatePath("/ads");
    return {
      status: "success",
      message: `Draft ready: ${variant.headlines.length} headlines and ${variant.descriptions.length} descriptions.`,
    };
  } catch (error) {
    log.error("variant generation failed", { error, adRowId });
    return { status: "error", message: toUserMessage(error) };
  }
}

const decisionSchema = z.object({
  variantId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function reviewVariantAction(input: z.input<typeof decisionSchema>): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");
    const parsed = decisionSchema.parse(input);

    const updated = await prisma.adVariant.updateMany({
      where: {
        id: parsed.variantId,
        organizationId: context.organization.id,
        status: "DRAFT",
      },
      data: {
        status: parsed.decision === "approve" ? "APPROVED" : "REJECTED",
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0) throw errors.notFound("That draft is no longer waiting for review.");

    revalidatePath("/ads");
    return {
      status: "success",
      message: parsed.decision === "approve" ? "Draft approved." : "Draft rejected.",
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function publishVariantAction(variantId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");

    const variant = await prisma.adVariant.findFirst({
      where: { id: variantId, organizationId: context.organization.id, status: "APPROVED" },
      select: {
        id: true,
        accountId: true,
        headlines: true,
        descriptions: true,
        finalUrl: true,
        path1: true,
        path2: true,
        adGroup: { select: { adGroupId: true, name: true } },
        sourceAd: { select: { adId: true } },
      },
    });
    if (!variant) {
      throw errors.notFound("Approve the draft before publishing it.");
    }
    if (!variant.finalUrl) {
      return {
        status: "error",
        message: "This draft has no landing page URL, so Google would reject it.",
      };
    }

    const headlines = variant.headlines as string[];
    const descriptions = variant.descriptions as string[];

    const outcome = await applyManualChange({
      organizationId: context.organization.id,
      accountId: variant.accountId,
      userId: context.user.id,
      type: "CREATE_AD_VARIANT",
      targetType: "AD",
      targetId: variant.adGroup.adGroupId,
      targetName: headlines[0] ?? "New responsive search ad",
      title: `Publish a new ad in ${variant.adGroup.name}`,
      reason: "Approved from the ad drafts list.",
      expectedImpact: "Adds a variant so Google can rotate against the current ads.",
      payload: {
        action: "create_ad_variant",
        adGroupId: variant.adGroup.adGroupId,
        sourceAdId: variant.sourceAd?.adId ?? null,
        headlines,
        descriptions,
        finalUrl: variant.finalUrl,
        path1: variant.path1,
        path2: variant.path2,
      },
      evidence: { headlines: headlines.length, descriptions: descriptions.length },
    });

    if (outcome.status !== "SUCCEEDED") {
      await prisma.adVariant.update({ where: { id: variant.id }, data: { status: "FAILED" } });
      return { status: "error", message: outcome.message };
    }

    await prisma.adVariant.update({
      where: { id: variant.id },
      data: { status: "PUBLISHED" },
    });

    revalidatePath("/ads");
    return { status: "success", message: "The new ad was created in Google Ads." };
  } catch (error) {
    log.error("variant publish failed", { error, variantId });
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function pauseAdAction(adRowId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");

    const ad = await prisma.ad.findFirst({
      where: { id: adRowId, organizationId: context.organization.id },
      select: {
        id: true,
        adId: true,
        accountId: true,
        headlines: true,
        adGroup: { select: { adGroupId: true, name: true } },
      },
    });
    if (!ad) throw errors.notFound("That ad is no longer available.");

    const headlines = Array.isArray(ad.headlines) ? (ad.headlines as string[]) : [];

    const outcome = await applyManualChange({
      organizationId: context.organization.id,
      accountId: ad.accountId,
      userId: context.user.id,
      type: "PAUSE_AD",
      targetType: "AD",
      targetId: ad.adId,
      targetName: headlines[0] ?? `Ad ${ad.adId}`,
      title: `Pause an ad in ${ad.adGroup.name}`,
      reason: "Paused from the ads table.",
      expectedImpact: "Traffic moves to the remaining ads in the ad group.",
      payload: { action: "pause_ad", adGroupId: ad.adGroup.adGroupId, adId: ad.adId },
      evidence: {},
    });

    revalidatePath("/ads");
    return outcome.status === "SUCCEEDED"
      ? { status: "success", message: "The ad was paused." }
      : { status: "error", message: outcome.message };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}
