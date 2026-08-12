import "server-only";

import { resolveRange } from "@/lib/analytics/date-range";
import { formatCurrency, formatDelta, formatDecimal, formatRatio } from "@/lib/analytics/format";
import { getAccountSettings } from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/env";
import { dayBucket, runJob, runKeyFor } from "@/lib/jobs/runner";
import { createLogger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { weeklyDigestTemplate } from "@/lib/notifications/templates";
import { buildReport } from "@/lib/reports/builder";
import { getEntitlements } from "@/lib/billing/limits";

/**
 * Weekly digest.
 *
 * One email per account per week, to the members who asked for it and whose address is
 * verified. The numbers come from the same report builder the /reports page uses, so the
 * email can never disagree with the dashboard.
 */

const log = createLogger("jobs.digest");

export async function runDigestStage(): Promise<{
  accounts: number;
  sent: number;
  skipped: number;
}> {
  const accounts = await prisma.googleAdsAccount.findMany({
    where: {
      isActive: true,
      settings: { weeklyReportEmail: true },
    },
    select: {
      id: true,
      organizationId: true,
      descriptiveName: true,
      currencyCode: true,
      timeZone: true,
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const account of accounts) {
    const outcome = await runJob(
      {
        type: "SEND_DIGEST",
        runKey: runKeyFor("SEND_DIGEST", account.id, dayBucket()),
        scope: { organizationId: account.organizationId, accountId: account.id },
      },
      async () => {
        const entitlements = await getEntitlements(account.organizationId);
        if (!entitlements.limits.scheduledReports) return { skipped: true, recipients: 0 };

        const recipients = await recipientsFor(account.organizationId);
        if (recipients.length === 0) return { skipped: true, recipients: 0 };

        const scope = { organizationId: account.organizationId, accountId: account.id };
        const settings = await getAccountSettings(scope);
        const range = resolveRange("last_7", account.timeZone);
        const report = await buildReport(scope, range, settings);

        const currency = account.currencyCode;
        const rows = [
          {
            label: "Spend",
            value: formatCurrency(report.current.cost, currency),
            change: formatDelta(report.deltas.cost?.percent ?? null),
          },
          {
            label: "Revenue",
            value: formatCurrency(report.current.conversionValue, currency),
            change: formatDelta(report.deltas.conversionValue?.percent ?? null),
          },
          {
            label: "Conversions",
            value: formatDecimal(report.current.conversions, 1),
            change: formatDelta(report.deltas.conversions?.percent ?? null),
          },
          {
            label: "ROAS",
            value: formatRatio(report.current.roas),
            change: formatDelta(report.deltas.roas?.percent ?? null),
          },
          {
            label: "CPA",
            value: formatCurrency(report.current.cpa, currency),
            change: formatDelta(report.deltas.cpa?.percent ?? null),
          },
          ...(report.hasProfitModel
            ? [
                {
                  label: "Estimated profit",
                  value: formatCurrency(report.profit.netProfit, currency),
                },
              ]
            : []),
        ];

        const summary = digestSummary(report, currency);
        const url = appUrl(`/reports?account=${account.id}&range=last_7`);

        await Promise.all(
          recipients.map((to) =>
            sendEmail(
              weeklyDigestTemplate({
                to,
                accountName: account.descriptiveName,
                summary,
                rows,
                url,
              }),
            ),
          ),
        );

        return { skipped: false, recipients: recipients.length };
      },
    );

    if (outcome.status === "completed" && outcome.result?.skipped === false) sent += 1;
    else skipped += 1;
  }

  log.info("digest stage finished", { accounts: accounts.length, sent, skipped });
  return { accounts: accounts.length, sent, skipped };
}

async function recipientsFor(organizationId: string): Promise<string[]> {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: { user: { select: { email: true, emailVerifiedAt: true } } },
    take: 25,
  });

  return members
    .map((member) => member.user)
    .filter((user) => user.emailVerifiedAt !== null)
    .map((user) => user.email);
}

/** One honest sentence. No adjectives the data does not support. */
function digestSummary(
  report: Awaited<ReturnType<typeof buildReport>>,
  currency: string,
): string {
  const spend = formatCurrency(report.current.cost, currency);
  const revenue = formatCurrency(report.current.conversionValue, currency);
  const roasDelta = report.deltas.roas?.percent ?? null;

  const direction =
    roasDelta === null || Math.abs(roasDelta) < 2
      ? "held steady"
      : roasDelta > 0
        ? `improved ${formatDelta(roasDelta)}`
        : `fell ${formatDelta(Math.abs(roasDelta))}`;

  const waste =
    report.wastedSpend > 0
      ? ` ${formatCurrency(report.wastedSpend, currency)} went to search terms that did not convert.`
      : "";

  return `Last week you spent ${spend} and generated ${revenue}. ROAS ${direction} against the previous seven days.${waste}`;
}
