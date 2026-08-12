import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Link2, Plug } from "lucide-react";

import { discoverAccountsAction } from "@/app/(dashboard)/accounts/actions";
import { AccountList } from "@/app/(dashboard)/accounts/account-list";
import { ConnectPanel } from "@/app/(dashboard)/accounts/connect-panel";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { getAuthContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { getUsageSnapshot } from "@/lib/billing/limits";
import { describeLimit, planFor } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import { features } from "@/lib/env";
import { formatRelativeTime } from "@/lib/analytics/format";

export const metadata: Metadata = { title: "Google Ads accounts" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connection?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const canManage = can(context.role, "accounts:manage");

  const [accounts, connections, usage] = await Promise.all([
    prisma.googleAdsAccount.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ isDemo: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        customerId: true,
        descriptiveName: true,
        currencyCode: true,
        timeZone: true,
        isDemo: true,
        isActive: true,
        syncStatus: true,
        syncError: true,
        lastSyncedAt: true,
        connection: { select: { id: true, email: true, status: true } },
        _count: { select: { campaigns: true } },
      },
    }),
    prisma.googleConnection.findMany({
      where: { organizationId: context.organization.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        status: true,
        lastRefreshedAt: true,
        createdAt: true,
        _count: { select: { adsAccounts: true } },
      },
    }),
    getUsageSnapshot(context.organization.id),
  ]);

  const plan = planFor(usage.entitlements.plan);

  // Coming back from the OAuth callback, the account picker should already be filled in.
  const preselectedConnectionId = params.connection ?? null;
  const initialDiscovered =
    canManage && preselectedConnectionId
      ? await discoverAccountsAction(preselectedConnectionId).catch(() => null)
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Google Ads accounts"
        description="Connect the accounts you want analyzed. Every account keeps its own optimization settings, history and audit trail."
      />

      {params.error ? (
        <div className="flex gap-2.5 rounded-lg border border-negative/20 bg-negative-soft px-4 py-3">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" aria-hidden />
          <p className="text-[13px] leading-5 text-negative">{decodeURIComponent(params.error)}</p>
        </div>
      ) : null}

      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader
            title="Connected accounts"
            description={`${usage.accounts.used} of ${describeLimit(
              usage.accounts.limit,
            )} on the ${plan.name} plan`}
          />
          {usage.accounts.limit !== null && usage.accounts.used >= usage.accounts.limit ? (
            <Link
              href="/billing"
              className="text-[13px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Upgrade for more accounts
            </Link>
          ) : null}
        </SurfaceHeader>

        {accounts.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No accounts connected"
            description="Connect Google Ads to start syncing campaigns, keywords and search terms. You can also explore a demo account first."
          />
        ) : (
          <AccountList accounts={accounts} canManage={canManage} />
        )}
      </Surface>

      {canManage ? (
        <ConnectPanel
          connections={connections.map((connection) => ({
            id: connection.id,
            email: connection.email,
            status: connection.status,
            accountCount: connection._count.adsAccounts,
            lastRefreshedAt: connection.lastRefreshedAt
              ? formatRelativeTime(connection.lastRefreshedAt)
              : null,
          }))}
          googleConfigured={features.googleAds}
          preselectedConnectionId={preselectedConnectionId}
          initialDiscovered={initialDiscovered}
          hasDemoAccount={accounts.some((account) => account.isDemo)}
        />
      ) : (
        <Surface>
          <SectionHeader
            title="Connecting accounts"
            description="Your role can view accounts but not connect or remove them. Ask an owner or admin for access."
          />
        </Surface>
      )}

      <Surface>
        <SectionHeader
          title="What we store"
          description="Only what the product needs to analyze and optimize your account."
        />
        <ul className="mt-3 grid gap-2 text-[13px] leading-5 text-muted-foreground sm:grid-cols-2">
          <li className="flex gap-2">
            <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Campaigns, ad groups, keywords, search terms, ads and daily metrics.
          </li>
          <li className="flex gap-2">
            <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            OAuth refresh tokens, encrypted at rest and never sent to the browser.
          </li>
          <li className="flex gap-2">
            <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            No payment details, no account-level settings, no conversion tag changes.
          </li>
          <li className="flex gap-2">
            <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Disconnecting an account deletes its stored data from our side.
          </li>
        </ul>
        <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
          <StatusBadge tone="info">Scope</StatusBadge>
          We request the Google Ads scope only. Sign-in uses a separate, read-only profile scope.
        </p>
      </Surface>
    </div>
  );
}
