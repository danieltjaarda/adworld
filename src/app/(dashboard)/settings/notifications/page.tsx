import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NotificationsForm } from "@/app/(dashboard)/settings/notifications/notifications-form";
import { SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import { getAccountSettings } from "@/lib/analytics/queries";
import { getAuthContext, resolveActiveAccount } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { features } from "@/lib/env";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const account = await resolveActiveAccount(context);
  if (!account) {
    return (
      <Surface>
        <EmptyState
          title="No account connected"
          description="Notification preferences are set per Google Ads account."
          action={
            <Button asChild>
              <Link href="/accounts">Connect an account</Link>
            </Button>
          }
        />
      </Surface>
    );
  }

  const settings = await getAccountSettings({
    organizationId: context.organization.id,
    accountId: account.id,
  });

  return (
    <>
      <Surface>
        <SectionHeader
          title={`Notifications for ${account.descriptiveName}`}
          description="In-app notifications are always on. These switches control what also reaches your inbox."
        />
        <div className="mt-1">
          {!features.email ? (
            <p className="mt-3 rounded-lg bg-warning-soft px-3.5 py-2.5 text-[12px] leading-5 text-warning">
              No email provider is configured on this deployment, so emails are written to the
              server log instead of being sent. In-app notifications work normally.
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <NotificationsForm
            accountId={account.id}
            canManage={can(context.role, "settings:manage")}
            settings={{
              notifyOnRecommendation: settings.notifyOnRecommendation,
              notifyOnAnomaly: settings.notifyOnAnomaly,
              notifyOnAutoAction: settings.notifyOnAutoAction,
              weeklyReportEmail: settings.weeklyReportEmail,
            }}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader title="Delivery channels" />
        <dl className="mt-4 space-y-3">
          <Channel
            label="In app"
            status={<StatusBadge tone="positive">On</StatusBadge>}
            detail="The bell in the header. Always enabled."
          />
          <Channel
            label="Email"
            status={
              features.email ? (
                <StatusBadge tone="positive">Configured</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Not configured</StatusBadge>
              )
            }
            detail={`Sent to ${context.user.email}.`}
          />
          <Channel
            label="Slack"
            status={<StatusBadge tone="neutral">Planned</StatusBadge>}
            detail="Not available yet."
          />
        </dl>
      </Surface>
    </>
  );
}

function Channel({
  label,
  status,
  detail,
}: {
  label: string;
  status: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <div>
        <dt className="text-[13px] font-medium">{label}</dt>
        <dd className="mt-0.5 text-[12px] text-muted-foreground">{detail}</dd>
      </div>
      {status}
    </div>
  );
}
