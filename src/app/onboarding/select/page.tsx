import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { discoverAccountsAction } from "@/app/(dashboard)/accounts/actions";
import { SelectAccountList } from "@/app/onboarding/select/select-list";
import { StepIndicator } from "@/components/onboarding/steps";
import { getAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { toUserMessage } from "@/lib/errors";

export const metadata: Metadata = { title: "Choose a Google Ads account" };

export default async function OnboardingSelectPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const connections = await prisma.googleConnection.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });

  if (connections.length === 0) redirect("/onboarding/connect");

  // The first connection's accounts are fetched here so the list is filled on arrival.
  const initial = await discoverAccountsAction(connections[0].id).then(
    (accounts) => ({ accounts, error: null }),
    (error: unknown) => ({ accounts: null, error: toUserMessage(error) }),
  );

  return (
    <div className="space-y-6">
      <StepIndicator current="select" />

      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="border-b border-border px-6 py-5 sm:px-8">
          <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
            Which account should we optimize?
          </h1>
          <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            Pick one to get started. You can connect the rest later from Google Ads accounts, and
            each account keeps its own goals and optimization mode.
          </p>
        </div>

        <SelectAccountList
          connections={connections}
          initialAccounts={initial.accounts}
          initialError={initial.error}
        />
      </div>

      <p className="text-center text-[13px] text-muted-foreground">
        Wrong Google account?{" "}
        <Link
          href="/api/google-ads/connect?next=/onboarding/select"
          prefetch={false}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Connect a different one
        </Link>
      </p>
    </div>
  );
}
