"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/components/forms/form-state";
import { invalidateAccountSummary } from "@/lib/ai/summary";
import { recordAudit } from "@/lib/audit/log";
import { requireAuth, requireAuthWith } from "@/lib/auth/context";
import { changePassword } from "@/lib/auth/service";
import { destroyAllSessions } from "@/lib/auth/session";
import { changePasswordSchema, fieldErrors, nameSchema } from "@/lib/auth/validation";
import { assertAutomaticModeAllowed } from "@/lib/billing/limits";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";

/**
 * Settings mutations. Each one validates, checks the caller's role, writes, and leaves
 * an audit entry when the change affects other people (organization, team, safety
 * limits) rather than only the person making it.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: nameSchema,
  timezone: z.string().trim().min(1).max(64),
});

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuth();
    await prisma.user.update({
      where: { id: context.user.id },
      data: { name: parsed.data.name, timezone: parsed.data.timezone },
    });

    revalidatePath("/", "layout");
    return { status: "success", message: "Profile updated." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

const organizationSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(120),
  currencyCode: z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase(),
  timezone: z.string().trim().min(1).max(64),
});

export async function updateOrganizationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = organizationSchema.safeParse({
    name: formData.get("name"),
    currencyCode: formData.get("currencyCode"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuthWith("org:manage");

    const before = {
      name: context.organization.name,
      currencyCode: context.organization.currencyCode,
      timezone: context.organization.timezone,
    };

    await prisma.organization.update({
      where: { id: context.organization.id },
      data: parsed.data,
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "organization.updated",
      entityType: "organization",
      entityId: context.organization.id,
      summary: `Updated workspace settings`,
      before,
      after: parsed.data,
    });

    revalidatePath("/", "layout");
    return { status: "success", message: "Workspace updated." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Optimization settings
// ---------------------------------------------------------------------------

const optionalPositive = z
  .union([z.literal(""), z.coerce.number().positive()])
  .transform((value) => (value === "" ? null : value));

const optionalPercent = z
  .union([z.literal(""), z.coerce.number().min(0).max(100)])
  .transform((value) => (value === "" ? null : value));

const toggle = (formData: FormData, key: string) => formData.get(key) === "on";

const optimizationSchema = z.object({
  accountId: z.string().uuid(),
  mode: z.enum(["SUGGESTIONS", "APPROVAL", "AUTOMATIC"]),
  targetRoas: optionalPositive,
  targetCpa: optionalPositive,
  maxDailyBudget: optionalPositive,
  minProfitPerConversion: optionalPositive,
  grossMarginPct: optionalPercent,
  leadValue: optionalPositive,
  fixedCostPerOrder: optionalPositive,
  maxDailyBudgetIncreasePct: z.coerce.number().min(0).max(100),
  maxDailyBudgetDecreasePct: z.coerce.number().min(0).max(50),
  maxBidChangePct: z.coerce.number().min(0).max(50),
  maxActionsPerRun: z.coerce.number().int().min(1).max(100),
  minClicksForDecision: z.coerce.number().int().min(1).max(10_000),
  minImpressionsForDecision: z.coerce.number().int().min(1).max(1_000_000),
  minSpendForDecision: z.coerce.number().min(0).max(1_000_000),
  minConversionsForScaling: z.coerce.number().min(0).max(1000),
  lookbackDays: z.coerce.number().int().min(7).max(180),
  minConfidence: z.coerce.number().min(0.3).max(0.99),
});

export async function updateOptimizationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = optimizationSchema.safeParse({
    accountId: formData.get("accountId"),
    mode: formData.get("mode"),
    targetRoas: formData.get("targetRoas") ?? "",
    targetCpa: formData.get("targetCpa") ?? "",
    maxDailyBudget: formData.get("maxDailyBudget") ?? "",
    minProfitPerConversion: formData.get("minProfitPerConversion") ?? "",
    grossMarginPct: formData.get("grossMarginPct") ?? "",
    leadValue: formData.get("leadValue") ?? "",
    fixedCostPerOrder: formData.get("fixedCostPerOrder") ?? "",
    maxDailyBudgetIncreasePct: formData.get("maxDailyBudgetIncreasePct"),
    maxDailyBudgetDecreasePct: formData.get("maxDailyBudgetDecreasePct"),
    maxBidChangePct: formData.get("maxBidChangePct"),
    maxActionsPerRun: formData.get("maxActionsPerRun"),
    minClicksForDecision: formData.get("minClicksForDecision"),
    minImpressionsForDecision: formData.get("minImpressionsForDecision"),
    minSpendForDecision: formData.get("minSpendForDecision"),
    minConversionsForScaling: formData.get("minConversionsForScaling"),
    lookbackDays: formData.get("lookbackDays"),
    minConfidence: formData.get("minConfidence"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuthWith("settings:manage");
    const { accountId, ...values } = parsed.data;

    const account = await prisma.googleAdsAccount.findFirst({
      where: { id: accountId, organizationId: context.organization.id },
      select: { id: true, descriptiveName: true },
    });
    if (!account) throw errors.notFound("That account is not available.");

    if (values.mode === "AUTOMATIC") {
      await assertAutomaticModeAllowed(context.organization.id);
    }

    const automation = {
      autoNegativeKeywords: toggle(formData, "autoNegativeKeywords"),
      autoAddKeywords: toggle(formData, "autoAddKeywords"),
      autoBidChanges: toggle(formData, "autoBidChanges"),
      autoBudgetChanges: toggle(formData, "autoBudgetChanges"),
      autoPauseKeywords: toggle(formData, "autoPauseKeywords"),
      autoPauseAds: toggle(formData, "autoPauseAds"),
    };

    const before = await prisma.optimizationSettings.findUnique({
      where: { accountId: account.id },
    });

    await prisma.optimizationSettings.upsert({
      where: { accountId: account.id },
      update: { ...values, ...automation },
      create: { accountId: account.id, ...values, ...automation },
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "settings.optimization.updated",
      entityType: "google_ads_account",
      entityId: account.id,
      summary: `Updated optimization settings for ${account.descriptiveName} (${values.mode.toLowerCase()} mode)`,
      before: before ? JSON.parse(JSON.stringify(before)) : undefined,
      after: { ...values, ...automation },
    });

    await invalidateAccountSummary(account.id);
    revalidatePath("/", "layout");

    return { status: "success", message: "Optimization settings saved." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function updateNotificationsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireAuthWith("settings:manage");
    const accountId = z.string().uuid().parse(formData.get("accountId"));

    const account = await prisma.googleAdsAccount.findFirst({
      where: { id: accountId, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!account) throw errors.notFound("That account is not available.");

    const values = {
      notifyOnRecommendation: toggle(formData, "notifyOnRecommendation"),
      notifyOnAnomaly: toggle(formData, "notifyOnAnomaly"),
      notifyOnAutoAction: toggle(formData, "notifyOnAutoAction"),
      weeklyReportEmail: toggle(formData, "weeklyReportEmail"),
    };

    await prisma.optimizationSettings.upsert({
      where: { accountId: account.id },
      update: values,
      create: { accountId: account.id, ...values },
    });

    revalidatePath("/settings/notifications");
    return { status: "success", message: "Notification preferences saved." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuth();
    await changePassword(
      context.user.id,
      parsed.data.currentPassword,
      parsed.data.password,
      context.sessionId,
    );

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "security.password.changed",
      entityType: "user",
      entityId: context.user.id,
      summary: "Changed their password and signed out other sessions",
    });

    revalidatePath("/settings/security");
    return {
      status: "success",
      message: "Password changed. Other devices have been signed out.",
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionState> {
  try {
    const context = await requireAuth();
    const count = await destroyAllSessions(context.user.id, context.sessionId);

    revalidatePath("/settings/security");
    return {
      status: "success",
      message:
        count === 0
          ? "No other sessions were active."
          : `Signed out ${count} other ${count === 1 ? "session" : "sessions"}.`,
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function revokeSessionAction(sessionId: string): Promise<ActionState> {
  try {
    const context = await requireAuth();

    if (sessionId === context.sessionId) {
      return { status: "error", message: "Use sign out to end the session you are using." };
    }

    const deleted = await prisma.session.deleteMany({
      where: { id: sessionId, userId: context.user.id },
    });
    if (deleted.count === 0) throw errors.notFound("That session has already ended.");

    revalidatePath("/settings/security");
    return { status: "success", message: "Session ended." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function deleteOrganizationAction(confirmation: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("org:delete");

    if (confirmation.trim() !== context.organization.name) {
      return { status: "error", message: "Type the workspace name exactly to confirm." };
    }
    if (context.memberships.length < 2) {
      return {
        status: "error",
        message: "This is your only workspace. Deleting it would leave you without one.",
      };
    }

    await prisma.organization.delete({ where: { id: context.organization.id } });
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
