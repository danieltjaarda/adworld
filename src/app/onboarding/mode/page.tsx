import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModeStep } from "@/app/onboarding/mode/mode-step";
import { StepIndicator } from "@/components/onboarding/steps";
import { getAuthContext } from "@/lib/auth/context";
import { getEntitlements } from "@/lib/billing/limits";
import { planFor } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Choose an optimization mode" };

export default async function OnboardingModePage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const account = await prisma.googleAdsAccount.findFirst({
    where: { organizationId: context.organization.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, descriptiveName: true, settings: { select: { mode: true } } },
  });
  if (!account) redirect("/onboarding/connect");

  const entitlements = await getEntitlements(context.organization.id);

  return (
    <div className="space-y-6">
      <StepIndicator current="mode" />

      <div className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
          How much should the AI be allowed to do?
        </h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          This applies to {account.descriptiveName}. You can change it at any time, and switching to
          a stricter mode immediately stops anything queued.
        </p>

        <div className="mt-6">
          <ModeStep
            initialMode={account.settings?.mode ?? "APPROVAL"}
            automaticAllowed={entitlements.limits.automaticMode}
            planName={planFor(entitlements.plan).name}
          />
        </div>
      </div>
    </div>
  );
}
