import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { ActionStatus, ActorType } from "@/generated/prisma/enums";
import type { ActionPayload } from "@/lib/ai/schemas";
import { unitsToMicros } from "@/lib/analytics/money";
import { getAccountSettings, type AccountSettings } from "@/lib/analytics/queries";
import { recordAudit } from "@/lib/audit/log";
import { assertWithinUsage, assertWriteEnabled, recordUsage } from "@/lib/billing/limits";
import { prisma } from "@/lib/db/prisma";
import { AppError, isAppError } from "@/lib/errors";
import { createProvider } from "@/lib/google-ads/provider";
import { getConnectionAccessToken } from "@/lib/google-ads/tokens";
import type { MutationRequest } from "@/lib/google-ads/types";
import { createLogger } from "@/lib/logger";
import { notify } from "@/lib/notifications/service";
import { decideExecution, enforceSafety } from "@/lib/optimization/safety";

/**
 * The execution path.
 *
 * A recommendation only ever becomes a live change here, and only after passing the
 * safety engine a second time against the account's *current* settings. Each action
 * carries an idempotency key, so a retried cron run or a double-clicked approve button
 * cannot apply the same mutation twice.
 */

const log = createLogger("optimization.executor");

const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

export type QueueInput = {
  organizationId: string;
  accountId: string;
  recommendationId: string;
  actorType: ActorType;
  requestedByUserId: string | null;
};

/**
 * Turns a recommendation into a queued action. Safe to call twice: the idempotency key
 * is derived from the recommendation, so the second call returns the existing action.
 */
export async function queueAction(input: QueueInput): Promise<{ actionId: string; created: boolean }> {
  const recommendation = await prisma.aIRecommendation.findFirst({
    where: {
      id: input.recommendationId,
      organizationId: input.organizationId,
      accountId: input.accountId,
    },
  });

  if (!recommendation) {
    throw new AppError("NOT_FOUND", "That recommendation no longer exists.");
  }

  if (recommendation.status === "EXECUTED") {
    throw new AppError("CONFLICT", "That recommendation has already been applied.");
  }

  // Entitlements are checked at queue time so the user sees the limit before anything
  // is claimed, and again implicitly by the executor refusing to run unqueued work.
  await assertWriteEnabled(input.organizationId);
  await assertWithinUsage(input.organizationId, "ai_actions");

  const idempotencyKey = idempotencyKeyFor(recommendation.id, recommendation.dedupeKey);

  const existing = await prisma.aIAction.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) return { actionId: existing.id, created: false };

  const action = await prisma.aIAction.create({
    data: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      recommendationId: recommendation.id,
      type: recommendation.type,
      targetType: recommendation.targetType,
      targetId: recommendation.targetId,
      targetName: recommendation.targetName,
      status: "QUEUED",
      actorType: input.actorType,
      requestedById: input.requestedByUserId,
      payload: recommendation.payload as object,
      idempotencyKey,
    },
    select: { id: true },
  });

  await prisma.aIRecommendation.update({
    where: { id: recommendation.id },
    data: {
      status: "APPROVED",
      reviewedById: input.requestedByUserId,
      reviewedAt: new Date(),
    },
  });

  await addLog(action.id, "INFO", "Action queued", { actorType: input.actorType });

  return { actionId: action.id, created: true };
}

function idempotencyKeyFor(recommendationId: string, dedupeKey: string): string {
  return createHash("sha256").update(`${recommendationId}:${dedupeKey}`).digest("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ExecutionOutcome = {
  actionId: string;
  status: ActionStatus;
  message: string;
};

export async function executeAction(
  organizationId: string,
  actionId: string,
): Promise<ExecutionOutcome> {
  const action = await prisma.aIAction.findFirst({
    where: { id: actionId, organizationId },
    include: {
      account: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true,
          isDemo: true,
          connectionId: true,
          loginCustomerId: true,
          currencyCode: true,
        },
      },
    },
  });

  if (!action) throw new AppError("NOT_FOUND", "That action no longer exists.");

  if (action.status === "SUCCEEDED" || action.status === "ROLLED_BACK") {
    return { actionId, status: action.status, message: "This action has already been applied." };
  }
  if (action.attempts >= MAX_ATTEMPTS) {
    return {
      actionId,
      status: "FAILED",
      message: "This action failed too many times and will not be retried automatically.",
    };
  }

  // Claiming the row prevents two concurrent runners from applying the same mutation.
  const claimed = await prisma.aIAction.updateMany({
    where: { id: actionId, organizationId, status: { in: ["QUEUED", "FAILED"] } },
    data: { status: "RUNNING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { actionId, status: "RUNNING", message: "This action is already running." };
  }

  const payload = action.payload as unknown as ActionPayload;
  const settings = await getAccountSettings({ organizationId, accountId: action.accountId });

  try {
    const guard = guardExecution(payload, settings, action.recommendationId ? action : null);
    if (!guard.ok) {
      await skip(action.id, guard.reason);
      return { actionId, status: "SKIPPED", message: guard.reason };
    }

    const previousState = await capturePreviousState(organizationId, action.accountId, guard.payload);
    const request = toMutationRequest(guard.payload);

    if (!request) {
      // Advisory recommendations (monitor, review tracking) have nothing to send to Google.
      await prisma.aIAction.update({
        where: { id: action.id },
        data: {
          status: "SUCCEEDED",
          executedAt: new Date(),
          previousState: previousState ?? undefined,
          result: { applied: false, note: "Advisory action, acknowledged without a change." },
        },
      });
      await finishRecommendation(action.recommendationId, "EXECUTED");
      return { actionId, status: "SUCCEEDED", message: "Marked as reviewed." };
    }

    const credentials =
      action.account.isDemo || !action.account.connectionId
        ? null
        : await getConnectionAccessToken(organizationId, action.account.connectionId);

    const provider = createProvider(action.account, credentials);

    // Dry run first. Google validates the whole operation and returns the same errors
    // it would on a real write, which turns most failures into a no-op.
    const validation = await provider.applyMutation(request, { validateOnly: true });
    if (!validation.success) {
      throw new AppError("GOOGLE_ADS_API", "Google Ads rejected this change during validation.", {
        details: validation.message,
      });
    }

    const result = await provider.applyMutation(request);
    if (!result.success) {
      throw new AppError("GOOGLE_ADS_API", "Google Ads rejected this change.", {
        details: result.message,
      });
    }

    await prisma.aIAction.update({
      where: { id: action.id },
      data: {
        status: "SUCCEEDED",
        executedAt: new Date(),
        previousState: previousState ?? undefined,
        result: {
          resourceName: result.resourceName,
          message: result.message,
          mode: provider.mode,
        },
        errorMessage: null,
      },
    });

    await applyLocally(organizationId, action.accountId, guard.payload);
    await finishRecommendation(action.recommendationId, "EXECUTED");
    await recordUsage(organizationId, "ai_actions", 1);
    await addLog(action.id, "INFO", result.message ?? "Applied", {
      resourceName: result.resourceName,
    });

    await recordAudit({
      organizationId,
      actorType: action.actorType,
      actorUserId: action.requestedById,
      actorLabel: action.actorType === "AI" ? "AI Agent" : "User",
      action: `optimization.${payload.action}`,
      entityType: action.targetType,
      entityId: action.targetId,
      summary: describeChange(payload, action.targetName, action.account.currencyCode),
      before: previousState ?? undefined,
      after: payload as unknown as Prisma.InputJsonValue,
      metadata: { actionId: action.id, mode: provider.mode },
    });

    if (action.actorType === "AI" && settings.notifyOnAutoAction) {
      await notify({
        organizationId,
        accountId: action.accountId,
        type: "OPTIMIZATION_COMPLETED",
        severity: "INFO",
        title: `Applied: ${describeChange(payload, action.targetName, action.account.currencyCode)}`,
        body: `AdLeverage applied this change automatically on ${action.account.descriptiveName}. You can undo it from the audit log.`,
        href: "/settings/audit-log",
        dedupeKey: `action:${action.id}`,
      });
    }

    return { actionId, status: "SUCCEEDED", message: result.message ?? "Applied." };
  } catch (error) {
    const message = isAppError(error)
      ? error.userMessage
      : "Something went wrong while applying this change.";

    await prisma.aIAction.update({
      where: { id: action.id },
      data: { status: "FAILED", errorMessage: message },
    });
    await addLog(action.id, "ERROR", message, {
      detail: isAppError(error) ? error.details : String(error),
    });
    await finishRecommendation(action.recommendationId, "FAILED");

    log.error("action failed", { actionId, error });

    await notify({
      organizationId,
      accountId: action.accountId,
      type: "OPTIMIZATION_FAILED",
      severity: "WARNING",
      title: `Could not apply a change on ${action.account.descriptiveName}`,
      body: message,
      href: "/recommendations",
      dedupeKey: `action-failed:${action.id}:${action.attempts}`,
    });

    return { actionId, status: "FAILED", message };
  }
}

/** Runs every queued action for an account, oldest first. Used by cron and by the UI. */
export async function runQueuedActions(
  organizationId: string,
  accountId: string,
  limit = 25,
): Promise<{ executed: number; failed: number; skipped: number }> {
  const queued = await prisma.aIAction.findMany({
    where: { organizationId, accountId, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let executed = 0;
  let failed = 0;
  let skipped = 0;

  // Sequential on purpose: Google Ads mutations on the same account are cheap but
  // order-sensitive, and a serial loop keeps the audit trail readable.
  for (const item of queued) {
    const outcome = await executeAction(organizationId, item.id);
    if (outcome.status === "SUCCEEDED") executed += 1;
    else if (outcome.status === "FAILED") failed += 1;
    else skipped += 1;
  }

  return { executed, failed, skipped };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

type Guard = { ok: true; payload: ActionPayload } | { ok: false; reason: string };

function guardExecution(
  payload: ActionPayload,
  settings: AccountSettings,
  action: { actorType: ActorType } | null,
): Guard {
  const verdict = enforceSafety(payload, settings);
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  const decision = decideExecution(verdict.payload, settings, {
    confidence: 1,
    risk: "LOW",
  });

  // A human approval is enough in Approval and Automatic mode; Suggestions mode blocks
  // every write, even one a user clicked, because that is what the setting promises.
  if (!decision.canExecuteOnApproval) return { ok: false, reason: decision.reason };

  if (action?.actorType === "AI" && !decision.canAutoExecute) {
    return { ok: false, reason: decision.reason };
  }

  return { ok: true, payload: verdict.payload };
}

async function skip(actionId: string, reason: string): Promise<void> {
  await prisma.aIAction.update({
    where: { id: actionId },
    data: { status: "SKIPPED", errorMessage: reason },
  });
  await addLog(actionId, "WARN", "Skipped", { reason });
}

async function finishRecommendation(
  recommendationId: string | null,
  status: "EXECUTED" | "FAILED",
): Promise<void> {
  if (!recommendationId) return;
  await prisma.aIRecommendation
    .update({ where: { id: recommendationId }, data: { status } })
    .catch(() => undefined);
}

async function addLog(
  actionId: string,
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await prisma.aIActionLog
    .create({ data: { actionId, level, message, data: data as object } })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Payload → Google mutation
// ---------------------------------------------------------------------------

/** Returns null for advisory actions that have no Google-side effect. */
export function toMutationRequest(payload: ActionPayload): MutationRequest | null {
  const micros = (value: number) => Number(unitsToMicros(value));

  switch (payload.action) {
    case "increase_budget":
    case "decrease_budget":
      return {
        kind: "campaign_budget",
        campaignId: payload.campaignId,
        budgetId: payload.budgetId,
        amountMicros: micros(payload.recommendedBudget),
      };

    case "increase_keyword_bid":
    case "decrease_keyword_bid":
      return {
        kind: "keyword_bid",
        adGroupId: payload.adGroupId,
        criterionId: payload.criterionId,
        cpcBidMicros: micros(payload.recommendedBid),
      };

    case "pause_keyword":
      return {
        kind: "keyword_status",
        adGroupId: payload.adGroupId,
        criterionId: payload.criterionId,
        status: "PAUSED",
      };

    case "enable_keyword":
      return {
        kind: "keyword_status",
        adGroupId: payload.adGroupId,
        criterionId: payload.criterionId,
        status: "ENABLED",
      };

    case "add_negative_keyword":
      return {
        kind: "negative_keyword",
        level: payload.level,
        campaignId: payload.campaignId ?? undefined,
        adGroupId: payload.adGroupId ?? undefined,
        text: payload.text,
        matchType: payload.matchType,
      };

    case "add_keyword":
      return {
        kind: "keyword",
        adGroupId: payload.adGroupId,
        text: payload.text,
        matchType: payload.matchType,
        cpcBidMicros: payload.cpcBid === null ? null : micros(payload.cpcBid),
        finalUrl: null,
      };

    case "pause_ad":
      return { kind: "ad_status", adGroupId: payload.adGroupId, adId: payload.adId, status: "PAUSED" };

    case "pause_campaign":
      return { kind: "campaign_status", campaignId: payload.campaignId, status: "PAUSED" };

    case "create_ad_variant":
      return {
        kind: "responsive_search_ad",
        adGroupId: payload.adGroupId,
        headlines: payload.headlines,
        descriptions: payload.descriptions,
        finalUrl: payload.finalUrl,
        path1: payload.path1,
        path2: payload.path2,
        // New creative always lands paused so a person sees it before it serves.
        paused: true,
      };

    case "review_conversion_tracking":
    case "monitor":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Before/after state
// ---------------------------------------------------------------------------

/** Snapshot of what we are about to change, so the action can be reversed later. */
async function capturePreviousState(
  organizationId: string,
  accountId: string,
  payload: ActionPayload,
): Promise<Prisma.JsonObject | null> {
  const scope = { organizationId, accountId };

  switch (payload.action) {
    case "increase_budget":
    case "decrease_budget": {
      const campaign = await prisma.campaign.findFirst({
        where: { ...scope, campaignId: payload.campaignId },
        select: { budgetAmountMicros: true, name: true },
      });
      return campaign
        ? {
            kind: "budget",
            campaignId: payload.campaignId,
            budgetId: payload.budgetId,
            amount: Number(campaign.budgetAmountMicros ?? 0n) / 1_000_000,
            name: campaign.name,
          }
        : null;
    }

    case "increase_keyword_bid":
    case "decrease_keyword_bid":
    case "pause_keyword":
    case "enable_keyword": {
      const keyword = await prisma.keyword.findFirst({
        where: { ...scope, criterionId: payload.criterionId },
        select: { cpcBidMicros: true, status: true, text: true, adGroup: { select: { adGroupId: true } } },
      });
      return keyword
        ? {
            kind: "keyword",
            criterionId: payload.criterionId,
            adGroupId: keyword.adGroup.adGroupId,
            bid: keyword.cpcBidMicros ? Number(keyword.cpcBidMicros) / 1_000_000 : null,
            status: keyword.status,
            text: keyword.text,
          }
        : null;
    }

    case "pause_ad": {
      const ad = await prisma.ad.findFirst({
        where: { ...scope, adId: payload.adId },
        select: { status: true },
      });
      return ad ? { kind: "ad", adId: payload.adId, status: ad.status } : null;
    }

    case "pause_campaign": {
      const campaign = await prisma.campaign.findFirst({
        where: { ...scope, campaignId: payload.campaignId },
        select: { status: true, name: true },
      });
      return campaign
        ? { kind: "campaign", campaignId: payload.campaignId, status: campaign.status }
        : null;
    }

    default:
      return null;
  }
}

/**
 * Mirrors the change locally so the dashboard is correct before the next sync. The
 * next sync overwrites this with Google's own state, so a wrong guess self-heals.
 */
async function applyLocally(
  organizationId: string,
  accountId: string,
  payload: ActionPayload,
): Promise<void> {
  const scope = { organizationId, accountId };

  try {
    switch (payload.action) {
      case "increase_budget":
      case "decrease_budget":
        await prisma.campaign.updateMany({
          where: { ...scope, campaignId: payload.campaignId },
          data: { budgetAmountMicros: unitsToMicros(payload.recommendedBudget) },
        });
        return;

      case "increase_keyword_bid":
      case "decrease_keyword_bid":
        await prisma.keyword.updateMany({
          where: { ...scope, criterionId: payload.criterionId },
          data: { cpcBidMicros: unitsToMicros(payload.recommendedBid) },
        });
        return;

      case "pause_keyword":
        await prisma.keyword.updateMany({
          where: { ...scope, criterionId: payload.criterionId },
          data: { status: "PAUSED" },
        });
        return;

      case "enable_keyword":
        await prisma.keyword.updateMany({
          where: { ...scope, criterionId: payload.criterionId },
          data: { status: "ENABLED" },
        });
        return;

      case "pause_ad":
        await prisma.ad.updateMany({ where: { ...scope, adId: payload.adId }, data: { status: "PAUSED" } });
        return;

      case "pause_campaign":
        await prisma.campaign.updateMany({
          where: { ...scope, campaignId: payload.campaignId },
          data: { status: "PAUSED" },
        });
        return;

      case "add_negative_keyword":
        await prisma.searchTerm.updateMany({
          where: { ...scope, text: payload.text },
          data: { status: "EXCLUDED" },
        });
        return;

      case "add_keyword":
        await prisma.searchTerm.updateMany({
          where: { ...scope, text: payload.text },
          data: { status: "ADDED" },
        });
        return;

      default:
        return;
    }
  } catch (error) {
    // Local mirroring is a convenience, never a correctness requirement.
    log.warn("local mirror failed", { error, action: payload.action });
  }
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export async function rollbackAction(
  organizationId: string,
  actionId: string,
  userId: string | null,
): Promise<ExecutionOutcome> {
  const action = await prisma.aIAction.findFirst({
    where: { id: actionId, organizationId, status: "SUCCEEDED" },
  });

  if (!action) {
    throw new AppError("NOT_FOUND", "There is no applied action to undo here.");
  }

  const previous = action.previousState as Prisma.JsonObject | null;
  const reversed = reversePayload(action.payload as unknown as ActionPayload, previous);

  if (!reversed) {
    throw new AppError("VALIDATION", "This change cannot be undone automatically.");
  }

  const idempotencyKey = idempotencyKeyFor(action.id, "rollback");
  const existing = await prisma.aIAction.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  const rollback =
    existing ??
    (await prisma.aIAction.create({
      data: {
        organizationId,
        accountId: action.accountId,
        type: action.type,
        targetType: action.targetType,
        targetId: action.targetId,
        targetName: action.targetName,
        status: "QUEUED",
        actorType: "USER",
        requestedById: userId,
        payload: reversed as unknown as object,
        idempotencyKey,
        rollbackOfId: action.id,
      },
      select: { id: true },
    }));

  const outcome = await executeAction(organizationId, rollback.id);

  if (outcome.status === "SUCCEEDED") {
    await prisma.aIAction.update({ where: { id: action.id }, data: { status: "ROLLED_BACK" } });
    await recordAudit({
      organizationId,
      actorType: "USER",
      actorUserId: userId,
      actorLabel: "User",
      action: "optimization.rollback",
      entityType: action.targetType,
      entityId: action.targetId,
      summary: `Reverted "${action.targetName}" to its previous state.`,
      metadata: { originalActionId: action.id, rollbackActionId: rollback.id },
    });
  }

  return outcome;
}

/** Builds the inverse of an applied change from the snapshot taken before it ran. */
function reversePayload(
  payload: ActionPayload,
  previous: Prisma.JsonObject | null,
): ActionPayload | null {
  if (!previous) return null;

  switch (payload.action) {
    case "increase_budget":
    case "decrease_budget": {
      const amount = Number(previous.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return {
        action: amount > payload.recommendedBudget ? "increase_budget" : "decrease_budget",
        campaignId: payload.campaignId,
        budgetId: payload.budgetId,
        currentBudget: payload.recommendedBudget,
        recommendedBudget: amount,
      };
    }

    case "increase_keyword_bid":
    case "decrease_keyword_bid": {
      const bid = Number(previous.bid);
      if (!Number.isFinite(bid) || bid <= 0) return null;
      return {
        action: bid > payload.recommendedBid ? "increase_keyword_bid" : "decrease_keyword_bid",
        adGroupId: payload.adGroupId,
        criterionId: payload.criterionId,
        keywordText: payload.keywordText,
        currentBid: payload.recommendedBid,
        recommendedBid: bid,
      };
    }

    case "pause_keyword":
      return {
        action: "enable_keyword",
        adGroupId: payload.adGroupId,
        criterionId: payload.criterionId,
        keywordText: payload.keywordText,
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Human-readable summaries
// ---------------------------------------------------------------------------

export function describeChange(
  payload: ActionPayload,
  targetName: string,
  currency: string,
): string {
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  switch (payload.action) {
    case "increase_budget":
    case "decrease_budget":
      return `Budget for ${targetName}: ${money(payload.currentBudget)} → ${money(
        payload.recommendedBudget,
      )} per day`;
    case "increase_keyword_bid":
    case "decrease_keyword_bid":
      return `Bid for "${payload.keywordText}": ${money(payload.currentBid)} → ${money(
        payload.recommendedBid,
      )}`;
    case "pause_keyword":
      return `Paused keyword "${payload.keywordText}"`;
    case "enable_keyword":
      return `Enabled keyword "${payload.keywordText}"`;
    case "add_negative_keyword":
      return `Added ${payload.matchType.toLowerCase()} negative "${payload.text}"`;
    case "add_keyword":
      return `Added ${payload.matchType.toLowerCase()} keyword "${payload.text}"`;
    case "pause_ad":
      return `Paused ad ${targetName}`;
    case "pause_campaign":
      return `Paused campaign ${targetName}`;
    case "create_ad_variant":
      return `Created a paused ad variant in ${targetName}`;
    case "review_conversion_tracking":
      return `Flagged conversion tracking for review`;
    case "monitor":
      return `Marked ${targetName} for monitoring`;
  }
}
