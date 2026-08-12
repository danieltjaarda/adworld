import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Set up your workspace" };

/**
 * Onboarding is a router, not a wizard with hidden state: the next step is derived from
 * what actually exists in the database, so refreshing or coming back later lands the
 * user exactly where they left off.
 */
export default async function OnboardingPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const [connectionCount, account] = await Promise.all([
    prisma.googleConnection.count({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
    }),
    prisma.googleAdsAccount.findFirst({
      where: { organizationId: context.organization.id, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);

  if (account) redirect("/onboarding/mode");
  if (connectionCount > 0) redirect("/onboarding/select");
  redirect("/onboarding/connect");
}
