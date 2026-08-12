import "dotenv/config";

import { prisma } from "@/lib/db/prisma";
import { analyzeAccount } from "@/lib/optimization/engine";
import { detectAnomalies } from "@/lib/optimization/anomalies";
import { hashPassword } from "@/lib/security/crypto";
import { syncAccount } from "@/lib/sync/account-sync";

/**
 * Development seed.
 *
 * Creates one workspace with a demo Google Ads account, fills it with 90 days of
 * generated data and runs the optimizer over it, so a fresh clone opens on a dashboard
 * that actually shows something. Re-running is safe: every write is keyed and updates
 * in place.
 *
 *   npm run db:seed
 */

const EMAIL = process.env.SEED_EMAIL ?? "demo@adleverage.app";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-1";

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.SEED_ALLOW_PRODUCTION) {
    throw new Error("Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=1 to override.");
  }

  const passwordHash = await hashPassword(PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: EMAIL,
      name: "Demo User",
      passwordHash,
      emailVerifiedAt: new Date(),
      timezone: "Europe/Amsterdam",
    },
    select: { id: true },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      currencyCode: "EUR",
      timezone: "Europe/Amsterdam",
      onboardingStep: "done",
      onboardingDoneAt: new Date(),
      subscription: { create: { plan: "GROWTH", status: "ACTIVE" } },
    },
    select: { id: true },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: "OWNER", isDefault: true },
    create: { organizationId: organization.id, userId: user.id, role: "OWNER", isDefault: true },
  });

  const account = await prisma.googleAdsAccount.upsert({
    where: {
      organizationId_customerId: { organizationId: organization.id, customerId: "9999999999" },
    },
    update: { isActive: true },
    create: {
      organizationId: organization.id,
      customerId: "9999999999",
      descriptiveName: "Demo Account",
      currencyCode: "EUR",
      timeZone: "Europe/Amsterdam",
      isDemo: true,
    },
    select: { id: true },
  });

  await prisma.optimizationSettings.upsert({
    where: { accountId: account.id },
    update: {},
    create: {
      accountId: account.id,
      mode: "APPROVAL",
      targetRoas: 4,
      grossMarginPct: 55,
      maxDailyBudget: 250,
    },
  });

  console.log("Syncing demo data…");
  const sync = await syncAccount(organization.id, account.id, { full: true });
  console.log(`  ${sync.counts.campaigns} campaigns, ${sync.counts.keywords} keywords, ${sync.counts.dailyMetrics} daily metrics`);

  console.log("Running the optimizer…");
  const analysis = await analyzeAccount(organization.id, account.id, { triggeredBy: "user" });
  console.log(`  ${analysis.created} recommendations`);

  const anomalies = await detectAnomalies(organization.id, account.id);
  console.log(`  ${anomalies.created} alerts`);

  console.log(`\nSign in at /login with ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
