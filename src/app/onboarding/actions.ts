"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/components/forms/form-state";
import { recordAudit } from "@/lib/audit/log";
import { requireAuth } from "@/lib/auth/context";
import { assertAutomaticModeAllowed } from "@/lib/billing/limits";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/auth/validation";

/**
 * Onboarding writes only two things: the optimization mode and the business goals.
 * Both are per-account settings, so a workspace with several accounts can hold several
 * different strategies.
 */

const positiveOptional = z
  .union([z.literal(""), z.coerce.number().positive()])
  .transform((value) => (value === "" ? null : value));

const goalsSchema = z.object({
  accountId: z.string().uuid(),
  mode: z.enum(["SUGGESTIONS", "APPROVAL", "AUTOMATIC"]),
  targetRoas: positiveOptional,
  targetCpa: positiveOptional,
  maxDailyBudget: positiveOptional,
  grossMarginPct: z
    .union([z.literal(""), z.coerce.number().min(0).max(100)])
    .transform((value) => (value === "" ? null : value)),
  minProfitPerConversion: positiveOptional,
  maxDailyBudgetIncreasePct: z.coerce.number().min(0).max(100),
  maxDailyBudgetDecreasePct: z.coerce.number().min(0).max(50),
});

export async function saveOnboardingGoalsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = goalsSchema.safeParse({
    accountId: formData.get("accountId"),
    mode: formData.get("mode"),
    targetRoas: formData.get("targetRoas") ?? "",
    targetCpa: formData.get("targetCpa") ?? "",
    maxDailyBudget: formData.get("maxDailyBudget") ?? "",
    grossMarginPct: formData.get("grossMarginPct") ?? "",
    minProfitPerConversion: formData.get("minProfitPerConversion") ?? "",
    maxDailyBudgetIncreasePct: formData.get("maxDailyBudgetIncreasePct") ?? 20,
    maxDailyBudgetDecreasePct: formData.get("maxDailyBudgetDecreasePct") ?? 20,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuth();
    const input = parsed.data;

    const account = await prisma.googleAdsAccount.findFirst({
      where: { id: input.accountId, organizationId: context.organization.id },
      select: { id: true, descriptiveName: true },
    });
    if (!account) throw errors.notFound("That account is not available.");

    if (input.mode === "AUTOMATIC") {
      await assertAutomaticModeAllowed(context.organization.id);
    }

    const settings = {
      mode: input.mode,
      targetRoas: input.targetRoas,
      targetCpa: input.targetCpa,
      maxDailyBudget: input.maxDailyBudget,
      grossMarginPct: input.grossMarginPct,
      minProfitPerConversion: input.minProfitPerConversion,
      maxDailyBudgetIncreasePct: input.maxDailyBudgetIncreasePct,
      maxDailyBudgetDecreasePct: input.maxDailyBudgetDecreasePct,
    };

    await prisma.optimizationSettings.upsert({
      where: { accountId: account.id },
      update: settings,
      create: { accountId: account.id, ...settings },
    });

    await prisma.organization.update({
      where: { id: context.organization.id },
      data: { onboardingStep: "DONE", onboardingDoneAt: new Date() },
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "onboarding.completed",
      entityType: "google_ads_account",
      entityId: account.id,
      summary: `Finished onboarding for ${account.descriptiveName} in ${input.mode.toLowerCase()} mode`,
      after: settings,
    });
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
