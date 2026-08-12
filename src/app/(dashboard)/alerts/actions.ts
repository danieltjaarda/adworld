"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/components/forms/form-state";
import { requireAuth, resolveActiveAccount } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { acknowledgeAnomaly, detectAnomalies } from "@/lib/optimization/anomalies";

export async function acknowledgeAnomalyAction(anomalyId: string): Promise<ActionState> {
  try {
    const context = await requireAuth();
    await acknowledgeAnomaly(context.organization.id, anomalyId);
    revalidatePath("/alerts");
    return { status: "success", message: "Marked as seen." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function resolveAnomalyAction(anomalyId: string): Promise<ActionState> {
  try {
    const context = await requireAuth();

    const updated = await prisma.anomaly.updateMany({
      where: { id: anomalyId, organizationId: context.organization.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (updated.count === 0) throw errors.notFound("That alert no longer exists.");

    revalidatePath("/alerts");
    return { status: "success", message: "Closed." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function rescanAnomaliesAction(): Promise<ActionState> {
  try {
    const context = await requireAuth();
    const account = await resolveActiveAccount(context);
    if (!account) throw errors.notFound("Connect an account first.");

    const result = await detectAnomalies(context.organization.id, account.id);

    revalidatePath("/alerts");
    return {
      status: "success",
      message:
        result.created > 0
          ? `${result.created} new ${result.created === 1 ? "alert" : "alerts"}.`
          : "Nothing unusual in the last 7 days.",
    };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}
