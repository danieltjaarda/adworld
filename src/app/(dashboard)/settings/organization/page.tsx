import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DangerZone } from "@/app/(dashboard)/settings/organization/danger-zone";
import { OrganizationForm } from "@/app/(dashboard)/settings/organization/organization-form";
import { SectionHeader } from "@/components/dashboard/page-header";
import { Surface } from "@/components/dashboard/surface";
import { formatDate } from "@/lib/analytics/format";
import { getAuthContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Organization" };

export default async function OrganizationSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const [organization, counts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: context.organization.id },
      select: { name: true, slug: true, currencyCode: true, timezone: true, createdAt: true },
    }),
    Promise.all([
      prisma.googleAdsAccount.count({
        where: { organizationId: context.organization.id, isActive: true },
      }),
      prisma.organizationMember.count({ where: { organizationId: context.organization.id } }),
    ]),
  ]);
  if (!organization) redirect("/dashboard");

  const canManage = can(context.role, "org:manage");
  const [accountCount, memberCount] = counts;

  return (
    <>
      <Surface>
        <SectionHeader
          title="Workspace"
          description="Defaults for new accounts and how dates and money are presented."
        />
        <div className="mt-4">
          <OrganizationForm
            name={organization.name}
            currencyCode={organization.currencyCode}
            timezone={organization.timezone}
            slug={organization.slug}
            canManage={canManage}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader title="Contents" />
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Google Ads accounts" value={String(accountCount)} />
          <Stat label="Team members" value={String(memberCount)} />
          <Stat label="Created" value={formatDate(organization.createdAt)} />
        </dl>
      </Surface>

      {can(context.role, "org:delete") ? (
        <DangerZone
          organizationName={organization.name}
          canDelete={context.memberships.length > 1}
        />
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 text-[16px] font-semibold">{value}</dd>
    </div>
  );
}
