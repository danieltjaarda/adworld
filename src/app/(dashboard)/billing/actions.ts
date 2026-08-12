"use server";

import { redirect } from "next/navigation";

import type { PlanTier } from "@/generated/prisma/enums";
import type { ActionState } from "@/components/forms/form-state";
import { recordAudit } from "@/lib/audit/log";
import { requireAuthWith } from "@/lib/auth/context";
import { toUserMessage } from "@/lib/errors";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/checkout";

/**
 * Billing is owner-only. Both actions end in a redirect to Stripe, so the browser never
 * holds a key and the session URL is single-use.
 */

export async function startCheckoutAction(tier: PlanTier): Promise<ActionState> {
  let url: string;

  try {
    const context = await requireAuthWith("billing:manage");

    url = await createCheckoutSession({
      organizationId: context.organization.id,
      tier,
      userEmail: context.user.email,
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "billing.checkout.started",
      entityType: "subscription",
      summary: `Started checkout for the ${tier.toLowerCase()} plan`,
    });
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }

  redirect(url);
}

export async function openPortalAction(): Promise<ActionState> {
  let url: string;

  try {
    const context = await requireAuthWith("billing:manage");
    url = await createPortalSession(context.organization.id);
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }

  redirect(url);
}
