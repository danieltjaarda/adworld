import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OptimizationForm } from "@/app/(dashboard)/settings/optimization/optimization-form";
import { SectionHeader } from "@/components/dashboard/page-header";
import { EmptyState, Surface } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import { getAccountSettings } from "@/lib/analytics/queries";
import { getAuthContext, resolveActiveAccount } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { getEntitlements } from "@/lib/billing/limits";
import { planFor } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "AI optimization" };

export default async function OptimizationSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const account = await resolveActiveAccount(context);
  if (!account) {
    return (
      <Surface>
        <EmptyState
          title="No account connected"
          description="Connect a Google Ads account to configure how the optimizer behaves."
          action={
            <Button asChild>
              <Link href="/accounts">Connect an account</Link>
            </Button>
          }
        />
      </Surface>
    );
  }

  const [settings, entitlements] = await Promise.all([
    getAccountSettings({ organizationId: context.organization.id, accountId: account.id }),
    getEntitlements(context.organization.id),
  ]);

  return (
    <>
      <Surface>
        <SectionHeader
          title={`Optimizer settings for ${account.descriptiveName}`}
          description="Every account in this workspace keeps its own mode, targets and limits. These values are enforced server-side — the model cannot talk its way past them."
        />
      </Surface>

      <OptimizationForm
        accountId={account.id}
        currency={account.currencyCode}
        settings={settings}
        canManage={can(context.role, "settings:manage")}
        automaticAllowed={entitlements.limits.automaticMode}
        planName={planFor(entitlements.plan).name}
      />
    </>
  );
}
