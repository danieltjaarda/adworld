import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { RecommendationTargetType, RecommendationType } from "@/generated/prisma/enums";
import { actionPayloadSchema, type ActionPayload } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { executeAction, queueAction, type ExecutionOutcome } from "@/lib/optimization/executor";

/**
 * Changes a person asks for directly from a table ("add this as a negative"), rather
 * than ones the optimizer proposed.
 *
 * They still become a recommendation first, so the same execution path, the same safety
 * checks and the same audit trail apply. The only difference is the source and the fact
 * that no one has to approve their own request twice.
 */

export type ManualChangeInput = {
  organizationId: string;
  accountId: string;
  userId: string;
  type: RecommendationType;
  targetType: RecommendationTargetType;
  targetId: string;
  targetName: string;
  title: string;
  reason: string;
  expectedImpact: string;
  payload: ActionPayload;
  evidence: Prisma.JsonObject;
};

export async function applyManualChange(input: ManualChangeInput): Promise<ExecutionOutcome> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: input.accountId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!account) throw new AppError("NOT_FOUND", "That account is not available.");

  // Re-validate rather than trusting the caller: this payload is about to become a
  // live mutation, and the browser is not a trusted source of one.
  const parsed = actionPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "That change could not be prepared.", {
      details: parsed.error.message,
    });
  }

  const dedupeKey = `manual:${input.type}:${hash(`${input.targetId}:${Date.now()}`)}`;

  const recommendation = await prisma.aIRecommendation.create({
    data: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      targetName: input.targetName,
      status: "APPROVED",
      source: "USER",
      priority: 90,
      risk: "LOW",
      confidence: 1,
      title: input.title,
      reason: input.reason,
      expectedImpact: input.expectedImpact,
      payload: parsed.data as unknown as Prisma.InputJsonValue,
      evidence: input.evidence,
      dedupeKey,
      reviewedById: input.userId,
      reviewedAt: new Date(),
    },
    select: { id: true },
  });

  const { actionId } = await queueAction({
    organizationId: input.organizationId,
    accountId: input.accountId,
    recommendationId: recommendation.id,
    actorType: "USER",
    requestedByUserId: input.userId,
  });

  return executeAction(input.organizationId, actionId);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
