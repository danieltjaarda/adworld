import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoalsForm } from "@/app/onboarding/goals/goals-form";
import { StepIndicator } from "@/components/onboarding/steps";
import { getAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Set your goals" };

const MODES = new Set(["SUGGESTIONS", "APPROVAL", "AUTOMATIC"]);

export default async function OnboardingGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const account = await prisma.googleAdsAccount.findFirst({
    where: { organizationId: context.organization.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      descriptiveName: true,
      currencyCode: true,
      settings: {
        select: {
          mode: true,
          targetRoas: true,
          targetCpa: true,
          maxDailyBudget: true,
          grossMarginPct: true,
          minProfitPerConversion: true,
          maxDailyBudgetIncreasePct: true,
          maxDailyBudgetDecreasePct: true,
        },
      },
    },
  });
  if (!account) redirect("/onboarding/connect");

  const params = await searchParams;
  const requested = params.mode?.toUpperCase();
  const mode = requested && MODES.has(requested) ? requested : (account.settings?.mode ?? "APPROVAL");

  const settings = account.settings;

  return (
    <div className="space-y-6">
      <StepIndicator current="goals" />

      <div className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
          What does a good result look like?
        </h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          These numbers decide what the optimizer treats as a winner and what it treats as waste.
          Leave anything blank if you don&rsquo;t know it yet — we&rsquo;ll fall back to the
          account&rsquo;s own averages.
        </p>

        <div className="mt-6">
          <GoalsForm
            accountId={account.id}
            accountName={account.descriptiveName}
            currency={account.currencyCode}
            mode={mode as "SUGGESTIONS" | "APPROVAL" | "AUTOMATIC"}
            defaults={{
              targetRoas: settings?.targetRoas ? Number(settings.targetRoas) : null,
              targetCpa: settings?.targetCpa ? Number(settings.targetCpa) : null,
              maxDailyBudget: settings?.maxDailyBudget ? Number(settings.maxDailyBudget) : null,
              grossMarginPct: settings?.grossMarginPct ? Number(settings.grossMarginPct) : null,
              minProfitPerConversion: settings?.minProfitPerConversion
                ? Number(settings.minProfitPerConversion)
                : null,
              maxDailyBudgetIncreasePct: Number(settings?.maxDailyBudgetIncreasePct ?? 20),
              maxDailyBudgetDecreasePct: Number(settings?.maxDailyBudgetDecreasePct ?? 20),
            }}
          />
        </div>
      </div>
    </div>
  );
}
