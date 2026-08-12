"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/components/forms/form-state";
import { invalidateAccountSummary } from "@/lib/ai/summary";
import { recordAudit } from "@/lib/audit/log";
import { requireAuth, requireAuthWith, resolveActiveAccount } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { analyzeAccount } from "@/lib/optimization/engine";
import { executeAction, queueAction, rollbackAction } from "@/lib/optimization/executor";

/**
 * The approval workflow. Approving is the only path from a recommendation to a live
 * change, and it always goes through the executor so safety, idempotency and the audit
 * trail apply identically to cron-triggered and human-triggered work.
 */

const log = createLogger("recommendations.actions");

async function loadRecommendation(organizationId: string, recommendationId: string) {
  const recommendation = await prisma.aIRecommendation.findFirst({
    where: { id: recommendationId, organizationId },
    select: { id: true, accountId: true, title: true, targetName: true, status: true },
  });
  if (!recommendation) throw errors.notFound("That recommendation no longer exists.");
  return recommendation;
}

export async function approveRecommendationAction(
  recommendationId: string,
): Promise<ActionState> {
  try {
    const context = await requireAuthWith("recommendations:review");
    const recommendation = await loadRecommendation(context.organization.id, recommendationId);

    const { actionId } = await queueAction({
      organizationId: context.organization.id,
      accountId: recommendation.accountId,
      recommendationId: recommendation.id,
      actorType: "USER",
      requestedByUserId: context.user.id,
    });

    const outcome = await executeAction(context.organization.id, actionId);

    await invalidateAccountSummary(recommendation.accountId);
    revalidatePath("/recommendations");
    revalidatePath("/dashboard");

    if (outcome.status === "SUCCEEDED") {
      return { status: "success", message: outcome.message };
    }
    if (outcome.status === "SKIPPED") {
      return { status: "error", message: outcome.message };
    }
    return { status: "error", message: outcome.message };
  } catch (error) {
    log.error("approve failed", { error, recommendationId });
    return { status: "error", message: toUserMessage(error) };
  }
}

const decisionSchema = z.object({
  recommendationId: z.string().uuid(),
  decision: z.enum(["reject", "ignore"]),
  note: z.string().max(400).optional(),
});

export async function dismissRecommendationAction(
  input: z.input<typeof decisionSchema>,
): Promise<ActionState> {
  try {
    const context = await requireAuthWith("recommendations:review");
    const parsed = decisionSchema.parse(input);
    const recommendation = await loadRecommendation(
      context.organization.id,
      parsed.recommendationId,
    );

    if (recommendation.status !== "PENDING") {
      return { status: "error", message: "That recommendation was already reviewed." };
    }

    await prisma.aIRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: parsed.decision === "reject" ? "REJECTED" : "IGNORED",
        reviewedById: context.user.id,
        reviewedAt: new Date(),
      },
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: `recommendation.${parsed.decision}`,
      entityType: "recommendation",
      entityId: recommendation.id,
      summary: `${parsed.decision === "reject" ? "Rejected" : "Ignored"}: ${recommendation.title}`,
      metadata: parsed.note ? { note: parsed.note } : undefined,
    });

    revalidatePath("/recommendations");
    return {
      status: "success",
      message: parsed.decision === "reject" ? "Rejected." : "Hidden from the list.",
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

/** Approves several pending recommendations in one pass, stopping at the first failure. */
export async function approveManyAction(recommendationIds: string[]): Promise<ActionState> {
  try {
    const context = await requireAuthWith("recommendations:review");
    const ids = z.array(z.string().uuid()).max(50).parse(recommendationIds);

    let applied = 0;
    const problems: string[] = [];

    for (const id of ids) {
      const recommendation = await prisma.aIRecommendation.findFirst({
        where: { id, organizationId: context.organization.id, status: "PENDING" },
        select: { id: true, accountId: true, title: true },
      });
      if (!recommendation) continue;

      try {
        const { actionId } = await queueAction({
          organizationId: context.organization.id,
          accountId: recommendation.accountId,
          recommendationId: recommendation.id,
          actorType: "USER",
          requestedByUserId: context.user.id,
        });
        const outcome = await executeAction(context.organization.id, actionId);
        if (outcome.status === "SUCCEEDED") applied += 1;
        else problems.push(`${recommendation.title}: ${outcome.message}`);
      } catch (error) {
        problems.push(`${recommendation.title}: ${toUserMessage(error)}`);
      }
    }

    revalidatePath("/recommendations");
    revalidatePath("/dashboard");

    if (applied === 0 && problems.length > 0) {
      return { status: "error", message: problems[0] };
    }

    return {
      status: "success",
      message:
        problems.length === 0
          ? `Applied ${applied} ${applied === 1 ? "change" : "changes"}.`
          : `Applied ${applied}, skipped ${problems.length}. ${problems[0]}`,
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function undoActionAction(actionId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("actions:execute");
    const outcome = await rollbackAction(context.organization.id, actionId, context.user.id);

    revalidatePath("/recommendations");
    revalidatePath("/settings/audit-log");

    return outcome.status === "ROLLED_BACK"
      ? { status: "success", message: outcome.message }
      : { status: "error", message: outcome.message };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

/** Re-runs the optimizer on demand instead of waiting for the next scheduled analysis. */
export async function reanalyzeAction(): Promise<ActionState> {
  try {
    const context = await requireAuth();

    const account = await resolveActiveAccount(context);
    if (!account) throw errors.notFound("Connect an account first.");

    const result = await analyzeAccount(context.organization.id, account.id, {
      triggeredBy: "user",
    });

    revalidatePath("/recommendations");
    return {
      status: "success",
      message:
        result.created > 0
          ? `${result.created} new ${result.created === 1 ? "recommendation" : "recommendations"}.`
          : "No new recommendations — the account looks fine right now.",
    };
  } catch (error) {
    log.error("reanalyze failed", { error });
    return { status: "error", message: toUserMessage(error) };
  }
}
