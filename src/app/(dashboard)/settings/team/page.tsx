import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InviteForm } from "@/app/(dashboard)/settings/team/invite-form";
import { MemberRow, InvitationRow } from "@/app/(dashboard)/settings/team/team-rows";
import { SectionHeader } from "@/components/dashboard/page-header";
import { Surface } from "@/components/dashboard/surface";
import { formatRelativeTime } from "@/lib/analytics/format";
import { getAuthContext } from "@/lib/auth/context";
import { ROLE_LABELS, can } from "@/lib/auth/rbac";
import { getUsageSnapshot } from "@/lib/billing/limits";
import { describeLimit } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Team" };

export default async function TeamSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const [members, invitations, usage] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, lastLoginAt: true } },
      },
    }),
    prisma.invitation.findMany({
      where: { organizationId: context.organization.id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
    getUsageSnapshot(context.organization.id),
  ]);

  const canManage = can(context.role, "team:manage");

  return (
    <>
      <Surface padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <SectionHeader
            title="Members"
            description={`${members.length} of ${describeLimit(usage.members.limit)} seats used`}
          />
        </div>

        <ul className="divide-y divide-border border-t border-border">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={{
                id: member.id,
                name: member.user.name,
                email: member.user.email,
                role: member.role,
                roleLabel: ROLE_LABELS[member.role],
                isYou: member.user.id === context.user.id,
                joined: formatRelativeTime(member.createdAt),
                lastActive: member.user.lastLoginAt
                  ? formatRelativeTime(member.user.lastLoginAt)
                  : "Never signed in",
              }}
              canManage={canManage}
              viewerIsOwner={context.role === "OWNER"}
            />
          ))}
        </ul>
      </Surface>

      {invitations.length > 0 ? (
        <Surface padded={false}>
          <div className="px-5 py-4">
            <SectionHeader title="Pending invitations" />
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={{
                  id: invitation.id,
                  email: invitation.email,
                  roleLabel: ROLE_LABELS[invitation.role],
                  sent: formatRelativeTime(invitation.createdAt),
                  expires: formatRelativeTime(invitation.expiresAt),
                }}
                canManage={canManage}
              />
            ))}
          </ul>
        </Surface>
      ) : null}

      {canManage ? (
        <Surface>
          <SectionHeader
            title="Invite someone"
            description="They receive an email with a link that expires in 7 days."
          />
          <div className="mt-4">
            <InviteForm />
          </div>
        </Surface>
      ) : null}

      <Surface>
        <SectionHeader title="What each role can do" />
        <dl className="mt-4 space-y-3">
          <Role
            label="Owner"
            detail="Everything, including billing, deleting the workspace and handing over ownership."
          />
          <Role
            label="Admin"
            detail="Manage accounts, settings, the team and approve changes. Cannot delete the workspace."
          />
          <Role
            label="Member"
            detail="Review and approve recommendations, change optimization settings, use the AI agent."
          />
          <Role label="Viewer" detail="Read-only access to dashboards, reports and the AI agent." />
        </dl>
      </Surface>
    </>
  );
}

function Role({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-[13px] font-medium">{label}</dt>
      <dd className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{detail}</dd>
    </div>
  );
}
