import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { AccountSwitcher } from "@/components/navigation/account-switcher";
import { MobileNav } from "@/components/navigation/mobile-nav";
import { NotificationsMenu } from "@/components/navigation/notifications-menu";
import { SidebarNav } from "@/components/navigation/sidebar-nav";
import { UserMenu } from "@/components/navigation/user-menu";
import { Button } from "@/components/ui/button";
import { getAuthContext, listAccounts, resolveActiveAccount } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";

/**
 * The application shell.
 *
 * Fixed sidebar on desktop, sheet on mobile, and one header that always answers "whose
 * data am I looking at?" — the account switcher never moves.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const accounts = await listAccounts(context.organization.id);

  // A workspace with nothing connected has nothing to show; onboarding owns that state.
  if (accounts.length === 0 && !context.organization.onboardingDoneAt) {
    redirect("/onboarding");
  }

  const activeAccount = await resolveActiveAccount(context);

  const [recommendationCount, alertCount, notifications, unreadCount] = await Promise.all([
    prisma.aIRecommendation.count({
      where: {
        organizationId: context.organization.id,
        status: "PENDING",
        ...(activeAccount ? { accountId: activeAccount.id } : {}),
      },
    }),
    prisma.anomaly.count({
      where: {
        organizationId: context.organization.id,
        status: "OPEN",
        ...(activeAccount ? { accountId: activeAccount.id } : {}),
      },
    }),
    prisma.notification.findMany({
      where: { organizationId: context.organization.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        body: true,
        href: true,
        severity: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { organizationId: context.organization.id, readAt: null },
    }),
  ]);

  const counts = { recommendations: recommendationCount, alerts: alertCount };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside
        data-app-chrome
        className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-border bg-sidebar lg:flex"
      >
        <div className="flex h-14 shrink-0 items-center px-4">
          <Link href="/dashboard" className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <Logo />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <SidebarNav counts={counts} />
        </div>

        <div className="shrink-0 border-t border-border p-2">
          <UserMenu
            name={context.user.name}
            email={context.user.email}
            imageUrl={context.user.imageUrl}
            role={`${ROLE_LABELS[context.role]} · ${context.organization.name}`}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[240px]">
        <header
          data-app-chrome
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6"
        >
          <MobileNav counts={counts} />

          <div className="lg:hidden">
            <Logo showWordmark={false} />
          </div>

          <AccountSwitcher
            accounts={accounts.map((account) => ({
              id: account.id,
              name: account.descriptiveName,
              customerId: account.customerId,
              isDemo: account.isDemo,
            }))}
            activeAccountId={activeAccount?.id ?? null}
            workspaces={context.memberships.map((membership) => ({
              id: membership.organizationId,
              name: membership.name,
            }))}
            activeWorkspaceId={context.organization.id}
          />

          <div className="ml-auto flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/ai">Ask the AI</Link>
            </Button>
            <NotificationsMenu notifications={notifications} unreadCount={unreadCount} />
          </div>
        </header>

        {!context.user.emailVerifiedAt ? (
          <div className="border-b border-warning/20 bg-warning-soft px-4 py-2 text-[13px] text-warning sm:px-6">
            Confirm your email address to receive alerts and reports.{" "}
            <Link href="/verify-email" className="font-medium underline underline-offset-4">
              Resend the link
            </Link>
          </div>
        ) : null}

        {activeAccount?.isDemo ? (
          <div className="border-b border-info/20 bg-info-soft px-4 py-2 text-[13px] text-info sm:px-6">
            You are viewing a demo account with generated data. Nothing here affects a real Google
            Ads account.{" "}
            <Link href="/accounts" className="font-medium underline underline-offset-4">
              Connect your own
            </Link>
          </div>
        ) : null}

        <main data-app-main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
