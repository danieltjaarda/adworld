"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/components/forms/form-state";
import { requireAuthWith } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { applyManualChange } from "@/lib/optimization/manual";

/**
 * The Search Term Optimizer's write surface: turn a term into a negative, promote it to
 * a keyword, or mark it as reviewed. Everything runs through the normal action pipeline.
 */

const log = createLogger("search-terms.actions");

const inputSchema = z.object({
  termId: z.string().uuid(),
  matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).default("PHRASE"),
  level: z.enum(["AD_GROUP", "CAMPAIGN"]).default("AD_GROUP"),
});

type TermInput = z.input<typeof inputSchema>;

async function loadTerm(organizationId: string, termId: string) {
  const term = await prisma.searchTerm.findFirst({
    where: { id: termId, organizationId },
    select: {
      id: true,
      text: true,
      accountId: true,
      clicks: true,
      costMicros: true,
      conversions: true,
      conversionValueMicros: true,
      campaign: { select: { campaignId: true, name: true } },
      adGroup: { select: { adGroupId: true, name: true } },
    },
  });
  if (!term) throw errors.notFound("That search term is no longer available.");
  return term;
}

export async function addNegativeKeywordAction(input: TermInput): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");
    const parsed = inputSchema.parse(input);
    const term = await loadTerm(context.organization.id, parsed.termId);

    const level = parsed.level === "AD_GROUP" && term.adGroup ? "AD_GROUP" : "CAMPAIGN";
    if (level === "CAMPAIGN" && !term.campaign) {
      return {
        status: "error",
        message: "This term is not attached to a campaign we can add a negative to.",
      };
    }

    const cost = Number(term.costMicros) / 1_000_000;

    const outcome = await applyManualChange({
      organizationId: context.organization.id,
      accountId: term.accountId,
      userId: context.user.id,
      type: "ADD_NEGATIVE_KEYWORD",
      targetType: "SEARCH_TERM",
      targetId: term.text.toLowerCase(),
      targetName: term.text,
      title: `Add "${term.text}" as a negative keyword`,
      reason: `Requested from the search terms table. The term spent ${cost.toFixed(2)} with ${term.conversions} conversions.`,
      expectedImpact: "Stops this query from matching again.",
      payload: {
        action: "add_negative_keyword",
        level,
        campaignId: term.campaign?.campaignId ?? null,
        adGroupId: term.adGroup?.adGroupId ?? null,
        text: term.text,
        matchType: parsed.matchType,
      },
      evidence: {
        clicks: Number(term.clicks),
        cost,
        conversions: term.conversions,
        conversionValue: Number(term.conversionValueMicros) / 1_000_000,
      },
    });

    revalidatePath("/search-terms");

    return outcome.status === "SUCCEEDED"
      ? { status: "success", message: `"${term.text}" was added as a negative keyword.` }
      : { status: "error", message: outcome.message };
  } catch (error) {
    log.error("add negative failed", { error });
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function addKeywordAction(input: TermInput): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");
    const parsed = inputSchema.parse(input);
    const term = await loadTerm(context.organization.id, parsed.termId);

    if (!term.adGroup) {
      return {
        status: "error",
        message: "We need to know which ad group this term belongs to before adding it.",
      };
    }

    const cost = Number(term.costMicros) / 1_000_000;
    const value = Number(term.conversionValueMicros) / 1_000_000;

    const outcome = await applyManualChange({
      organizationId: context.organization.id,
      accountId: term.accountId,
      userId: context.user.id,
      type: "ADD_KEYWORD",
      targetType: "SEARCH_TERM",
      targetId: term.text.toLowerCase(),
      targetName: term.text,
      title: `Add "${term.text}" as a keyword`,
      reason: `Requested from the search terms table. The term produced ${term.conversions} conversions from ${cost.toFixed(2)} spend.`,
      expectedImpact: "Gives this query its own bid and quality score.",
      payload: {
        action: "add_keyword",
        adGroupId: term.adGroup.adGroupId,
        text: term.text,
        matchType: parsed.matchType,
        cpcBid: null,
      },
      evidence: {
        clicks: Number(term.clicks),
        cost,
        conversions: term.conversions,
        conversionValue: value,
      },
    });

    revalidatePath("/search-terms");

    return outcome.status === "SUCCEEDED"
      ? { status: "success", message: `"${term.text}" was added to ${term.adGroup.name}.` }
      : { status: "error", message: outcome.message };
  } catch (error) {
    log.error("add keyword failed", { error });
    return { status: "error", message: toUserMessage(error) };
  }
}

/** Marks a term as handled so it stops showing up in the optimizer's waste list. */
export async function ignoreSearchTermAction(termId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");

    const updated = await prisma.searchTerm.updateMany({
      where: { id: termId, organizationId: context.organization.id },
      data: { intent: "IRRELEVANT", intentReason: "Marked as reviewed by a team member." },
    });
    if (updated.count === 0) throw errors.notFound("That search term is no longer available.");

    revalidatePath("/search-terms");
    return { status: "success", message: "Marked as reviewed." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}
