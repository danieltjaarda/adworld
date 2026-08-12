"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { OrganizationRole } from "@/generated/prisma/enums";
import type { ActionState } from "@/components/forms/form-state";
import { recordAudit } from "@/lib/audit/log";
import { requireAuthWith } from "@/lib/auth/context";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/auth/rbac";
import { emailSchema, fieldErrors } from "@/lib/auth/validation";
import { assertCanInviteMember } from "@/lib/billing/limits";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/env";
import { errors, toUserMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/notifications/email";
import { invitationTemplate } from "@/lib/notifications/templates";
import { generateToken, hashToken } from "@/lib/security/crypto";

/**
 * Team management. Roles are the tenant's own authorization boundary, so every change
 * here is audited and the last owner can never be removed or demoted.
 */

const INVITE_TTL_DAYS = 7;

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

export async function inviteMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    const context = await requireAuthWith("team:manage");
    await assertCanInviteMember(context.organization.id);

    const existing = await prisma.organizationMember.findFirst({
      where: { organizationId: context.organization.id, user: { email: parsed.data.email } },
      select: { id: true },
    });
    if (existing) {
      return { status: "error", message: "That person is already in this workspace." };
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.invitation.upsert({
      where: {
        organizationId_email: {
          organizationId: context.organization.id,
          email: parsed.data.email,
        },
      },
      update: {
        role: parsed.data.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedById: context.user.id,
        revokedAt: null,
        acceptedAt: null,
      },
      create: {
        organizationId: context.organization.id,
        email: parsed.data.email,
        role: parsed.data.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedById: context.user.id,
      },
    });

    await sendEmail(
      invitationTemplate({
        to: parsed.data.email,
        url: appUrl(`/invite/${token}`),
        organizationName: context.organization.name,
        inviterName: context.user.name ?? context.user.email,
      }),
    );

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "team.invited",
      entityType: "invitation",
      entityId: parsed.data.email,
      summary: `Invited ${parsed.data.email} as ${ROLE_LABELS[parsed.data.role]}`,
    });

    revalidatePath("/settings/team");
    return { status: "success", message: `Invitation sent to ${parsed.data.email}.` };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("team:manage");

    const updated = await prisma.invitation.updateMany({
      where: { id: invitationId, organizationId: context.organization.id, acceptedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) throw errors.notFound("That invitation is no longer open.");

    revalidatePath("/settings/team");
    return { status: "success", message: "Invitation revoked." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

const roleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

export async function changeMemberRoleAction(
  input: z.input<typeof roleSchema>,
): Promise<ActionState> {
  try {
    const context = await requireAuthWith("team:manage");
    const parsed = roleSchema.parse(input);

    const member = await prisma.organizationMember.findFirst({
      where: { id: parsed.memberId, organizationId: context.organization.id },
      select: { id: true, role: true, userId: true, user: { select: { email: true } } },
    });
    if (!member) throw errors.notFound("That member is not in this workspace.");

    if (parsed.role === "OWNER" && context.role !== "OWNER") {
      return { status: "error", message: "Only an owner can hand over ownership." };
    }
    if (member.role === "OWNER" && (await isLastOwner(context.organization.id))) {
      return {
        status: "error",
        message: "A workspace needs at least one owner. Promote someone else first.",
      };
    }
    if (!ASSIGNABLE_ROLES.includes(parsed.role) && parsed.role !== "OWNER") {
      return { status: "error", message: "That role cannot be assigned." };
    }

    await prisma.organizationMember.update({
      where: { id: member.id },
      data: { role: parsed.role as OrganizationRole },
    });

    // Handing over ownership steps the current owner down to admin, so a workspace
    // never ends up with two people who each think they are in charge.
    if (parsed.role === "OWNER" && context.role === "OWNER") {
      await prisma.organizationMember.updateMany({
        where: { organizationId: context.organization.id, userId: context.user.id },
        data: { role: "ADMIN" },
      });
    }

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "team.role.changed",
      entityType: "organization_member",
      entityId: member.id,
      summary: `Changed ${member.user.email} from ${ROLE_LABELS[member.role]} to ${ROLE_LABELS[parsed.role]}`,
      before: { role: member.role },
      after: { role: parsed.role },
    });

    revalidatePath("/settings/team");
    return { status: "success", message: `${member.user.email} is now ${ROLE_LABELS[parsed.role]}.` };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function removeMemberAction(memberId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("team:manage");

    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: context.organization.id },
      select: { id: true, role: true, userId: true, user: { select: { email: true } } },
    });
    if (!member) throw errors.notFound("That member is not in this workspace.");

    if (member.userId === context.user.id) {
      return { status: "error", message: "You cannot remove yourself from a workspace." };
    }
    if (member.role === "OWNER" && (await isLastOwner(context.organization.id))) {
      return { status: "error", message: "A workspace needs at least one owner." };
    }

    await prisma.organizationMember.delete({ where: { id: member.id } });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "team.removed",
      entityType: "organization_member",
      entityId: member.id,
      summary: `Removed ${member.user.email} from the workspace`,
    });

    revalidatePath("/settings/team");
    return { status: "success", message: `${member.user.email} was removed.` };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

async function isLastOwner(organizationId: string): Promise<boolean> {
  const owners = await prisma.organizationMember.count({
    where: { organizationId, role: "OWNER" },
  });
  return owners <= 1;
}
