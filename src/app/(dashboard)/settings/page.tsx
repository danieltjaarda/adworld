import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/app/(dashboard)/settings/profile-form";
import { SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Surface } from "@/components/dashboard/surface";
import { getAuthContext } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/analytics/format";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfileSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: context.user.id },
    select: {
      name: true,
      email: true,
      timezone: true,
      emailVerifiedAt: true,
      createdAt: true,
      passwordHash: true,
      oauthAccounts: { select: { provider: true } },
    },
  });
  if (!user) redirect("/login");

  return (
    <>
      <Surface>
        <SectionHeader title="Profile" description="How your name appears to your team." />
        <div className="mt-4">
          <ProfileForm name={user.name ?? ""} timezone={user.timezone ?? "Europe/Amsterdam"} />
        </div>
      </Surface>

      <Surface>
        <SectionHeader title="Account" />
        <dl className="mt-4 space-y-3">
          <Row label="Email">
            <span className="flex flex-wrap items-center gap-2">
              {user.email}
              {user.emailVerifiedAt ? (
                <StatusBadge tone="positive">Verified</StatusBadge>
              ) : (
                <Link href="/verify-email" className="text-primary underline-offset-4 hover:underline">
                  <StatusBadge tone="warning">Not verified</StatusBadge>
                </Link>
              )}
            </span>
          </Row>
          <Row label="Sign-in method">
            {user.oauthAccounts.length > 0
              ? `Google${user.passwordHash ? " and password" : ""}`
              : "Email and password"}
          </Row>
          <Row label="Workspace">
            {context.organization.name} · {ROLE_LABELS[context.role]}
          </Row>
          <Row label="Member since">{formatDate(user.createdAt)}</Row>
        </dl>
      </Surface>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[13px] font-medium">{children}</dd>
    </div>
  );
}
