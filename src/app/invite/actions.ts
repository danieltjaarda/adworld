"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/components/forms/form-state";
import { recordAudit } from "@/lib/audit/log";
import { requireAuth } from "@/lib/auth/context";
import { addMember } from "@/lib/auth/service";
import { setActiveOrganization } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { assertCanInviteMember } from "@/lib/billing/limits";
import { prisma } from "@/lib/db/prisma";
import { toUserMessage } from "@/lib/errors";
import { hashToken } from "@/lib/security/crypto";

export async function acceptInvitationAction(token: string): Promise<ActionState> {
  let organizationId: string | null = null;

  try {
    const context = await requireAuth();

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });

    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      return { status: "error", message: "This invitation is no longer valid." };
    }
    if (invitation.expiresAt < new Date()) {
      return { status: "error", message: "This invitation has expired." };
    }
    if (invitation.email.toLowerCase() !== context.user.email.toLowerCase()) {
      return {
        status: "error",
        message: "This invitation was sent to a different email address.",
      };
    }

    // The seat limit is checked again at acceptance: an invitation sent while there was
    // room should not slip through after the workspace filled up.
    await assertCanInviteMember(invitation.organizationId);

    await addMember(invitation.organizationId, context.user.id, invitation.role);
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    await recordAudit({
      organizationId: invitation.organizationId,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "team.joined",
      entityType: "organization_member",
      entityId: context.user.id,
      summary: `${context.user.email} joined as ${ROLE_LABELS[invitation.role]}`,
    });

    await setActiveOrganization(invitation.organizationId);
    organizationId = invitation.organizationId;
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }

  if (organizationId) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  return { status: "error", message: "Could not join that workspace." };
}
