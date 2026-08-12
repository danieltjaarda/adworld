import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AnomalySeverity, RecommendationTargetType } from "@/generated/prisma/enums";
import { rangeToDates, shiftDays, todayInTimeZone, toDateKey } from "@/lib/analytics/date-range";
import { derive, safePercentChange } from "@/lib/analytics/metrics";
import { toNumber } from "@/lib/analytics/money";
import { getAccountSettings } from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { notify } from "@/lib/notifications/service";

/**
 * Anomaly detection.
 *
 * Two seven-day windows, compared. That is deliberately simple: the goal is to catch
 * the handful of failures that actually cost money — spend running away, conversions
 * disappearing, tracking breaking — without generating a stream of noise that trains
 * people to ignore alerts.
 *
 * Every check has a volume floor. A campaign that went from 1 conversion to 0 is not
 * an anomaly, it is a small campaign.
 */

const log = createLogger("optimization.anomalies");

const WINDOW_DAYS = 7;

type Detected = {
  type: string;
  metric: string;
  entityType: RecommendationTargetType;
  entityId: string;
  entityName: string;
  severity: AnomalySeverity;
  title: string;
  description: string;
  currentValue: number;
  baselineValue: number;
  changePct: number;
  details?: Prisma.JsonObject;
};

export type AnomalyScanResult = {
  detected: number;
  created: number;
  resolved: number;
};

export async function detectAnomalies(
  organizationId: string,
  accountId: string,
): Promise<AnomalyScanResult> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId },
    select: { id: true, descriptiveName: true, timeZone: true, currencyCode: true },
  });
  if (!account) throw new Error("Account not found for anomaly scan");

  const settings = await getAccountSettings({ organizationId, accountId });

  // Yesterday is the last complete day; today is still filling up and would look like a crash.
  const end = shiftDays(todayInTimeZone(account.timeZone), -1);
  const current = { start: shiftDays(end, -(WINDOW_DAYS - 1)), end };
  const baseline = {
    start: shiftDays(current.start, -WINDOW_DAYS),
    end: shiftDays(current.start, -1),
  };

  const [currentTotals, baselineTotals] = await Promise.all([
    accountTotals(organizationId, accountId, current),
    accountTotals(organizationId, accountId, baseline),
  ]);

  const findings: Detected[] = [
    ...accountLevelChecks(account.descriptiveName, currentTotals, baselineTotals),
    ...(await campaignChecks(organizationId, accountId, current, baseline)),
  ];

  let created = 0;
  const seen: string[] = [];

  for (const finding of findings) {
    const dedupeKey = `${finding.type}:${finding.entityId}:${current.end}`;
    seen.push(dedupeKey);

    const existing = await prisma.anomaly.findUnique({
      where: { accountId_dedupeKey: { accountId, dedupeKey } },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.anomaly.create({
      data: {
        organizationId,
        accountId,
        type: finding.type,
        metric: finding.metric,
        entityType: finding.entityType,
        entityId: finding.entityId,
        entityName: finding.entityName,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        currentValue: finding.currentValue.toFixed(4),
        baselineValue: finding.baselineValue.toFixed(4),
        changePct: finding.changePct.toFixed(4),
        periodStart: new Date(`${current.start}T00:00:00.000Z`),
        periodEnd: new Date(`${current.end}T00:00:00.000Z`),
        details: finding.details,
        dedupeKey,
      },
    });
    created += 1;

    if (settings.notifyOnAnomaly) {
      await notify({
        organizationId,
        accountId,
        type: notificationTypeFor(finding.type),
        severity: finding.severity,
        title: finding.title,
        body: finding.description,
        href: "/alerts",
        dedupeKey: `anomaly:${dedupeKey}`,
        email: finding.severity === "CRITICAL" ? { accountName: account.descriptiveName } : null,
      });
    }
  }

  // An open anomaly that this scan no longer sees has corrected itself.
  const resolved = await prisma.anomaly.updateMany({
    where: {
      organizationId,
      accountId,
      status: "OPEN",
      createdAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 24) },
      dedupeKey: { notIn: seen.length > 0 ? seen : ["__none__"] },
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  log.info("anomaly scan complete", {
    accountId,
    detected: findings.length,
    created,
    resolved: resolved.count,
  });

  return { detected: findings.length, created, resolved: resolved.count };
}

// ---------------------------------------------------------------------------

async function accountTotals(
  organizationId: string,
  accountId: string,
  range: { start: string; end: string },
) {
  const aggregate = await prisma.dailyMetric.aggregate({
    where: { organizationId, accountId, level: "ACCOUNT", date: rangeToDates(range) },
    _sum: {
      impressions: true,
      clicks: true,
      costMicros: true,
      conversions: true,
      conversionValueMicros: true,
    },
  });

  return derive({
    impressions: toNumber(aggregate._sum.impressions ?? 0),
    clicks: toNumber(aggregate._sum.clicks ?? 0),
    costMicros: toNumber(aggregate._sum.costMicros ?? 0),
    conversions: aggregate._sum.conversions ?? 0,
    conversionValueMicros: toNumber(aggregate._sum.conversionValueMicros ?? 0),
  });
}

function accountLevelChecks(
  accountName: string,
  current: ReturnType<typeof derive>,
  baseline: ReturnType<typeof derive>,
): Detected[] {
  const findings: Detected[] = [];
  const entity = {
    entityType: "ACCOUNT" as const,
    entityId: "account",
    entityName: accountName,
  };

  // Spend spike — only meaningful once there is real money involved.
  const spendChange = safePercentChange(current.cost, baseline.cost);
  if (baseline.cost >= 50 && spendChange !== null && spendChange >= 40) {
    findings.push({
      ...entity,
      type: "SPEND_SPIKE",
      metric: "cost",
      severity: spendChange >= 100 ? "CRITICAL" : "WARNING",
      title: `Spend is up ${Math.round(spendChange)}% week over week`,
      description: `The account spent ${current.cost.toFixed(2)} in the last 7 days against ${baseline.cost.toFixed(
        2,
      )} the week before. Check for a budget change, a new campaign, or rising auction prices before anything else.`,
      currentValue: current.cost,
      baselineValue: baseline.cost,
      changePct: spendChange,
    });
  }

  // Conversions collapsing, including the total-loss case that usually means tracking broke.
  const conversionChange = safePercentChange(current.conversions, baseline.conversions);
  if (baseline.conversions >= 5 && conversionChange !== null && conversionChange <= -40) {
    const trackingSuspect = current.conversions === 0 && current.clicks >= baseline.clicks * 0.6;

    findings.push({
      ...entity,
      type: trackingSuspect ? "TRACKING_ISSUE" : "CONVERSION_DROP",
      metric: "conversions",
      severity: conversionChange <= -60 ? "CRITICAL" : "WARNING",
      title: trackingSuspect
        ? "Conversions stopped being recorded"
        : `Conversion volume dropped ${Math.abs(Math.round(conversionChange))}% compared with the previous 7-day period`,
      description: trackingSuspect
        ? `Traffic is still arriving — ${current.clicks} clicks in the last 7 days — but not a single conversion was recorded, against ${baseline.conversions.toFixed(
            0,
          )} the week before. This pattern almost always means the conversion tag stopped firing rather than a real drop in demand. Verify tracking before changing bids or budgets.`
        : `${current.conversions.toFixed(1)} conversions in the last 7 days against ${baseline.conversions.toFixed(
            1,
          )} the week before, on ${current.clicks} clicks. Nothing has been changed automatically.`,
      currentValue: current.conversions,
      baselineValue: baseline.conversions,
      changePct: conversionChange,
      details: { clicks: current.clicks, baselineClicks: baseline.clicks },
    });
  }

  // ROAS collapse.
  if (baseline.roas !== null && current.roas !== null && baseline.cost >= 50) {
    const roasChange = safePercentChange(current.roas, baseline.roas);
    if (roasChange !== null && roasChange <= -30) {
      findings.push({
        ...entity,
        type: "ROAS_DROP",
        metric: "roas",
        severity: roasChange <= -50 ? "CRITICAL" : "WARNING",
        title: `ROAS fell from ${baseline.roas.toFixed(2)}x to ${current.roas.toFixed(2)}x`,
        description: `Return on ad spend dropped ${Math.abs(Math.round(roasChange))}% week over week on ${current.cost.toFixed(
          2,
        )} of spend. Conversion value went from ${baseline.conversionValue.toFixed(2)} to ${current.conversionValue.toFixed(
          2,
        )}.`,
        currentValue: current.roas,
        baselineValue: baseline.roas,
        changePct: roasChange,
      });
    }
  }

  // CPC spike — a leading indicator that usually precedes a CPA problem.
  if (baseline.cpc !== null && current.cpc !== null && baseline.clicks >= 100) {
    const cpcChange = safePercentChange(current.cpc, baseline.cpc);
    if (cpcChange !== null && cpcChange >= 35) {
      findings.push({
        ...entity,
        type: "CPC_SPIKE",
        metric: "cpc",
        severity: "WARNING",
        title: `Average CPC is up ${Math.round(cpcChange)}%`,
        description: `Cost per click moved from ${baseline.cpc.toFixed(2)} to ${current.cpc.toFixed(
          2,
        )}. Competition or a bid change is making the same traffic more expensive.`,
        currentValue: current.cpc,
        baselineValue: baseline.cpc,
        changePct: cpcChange,
      });
    }
  }

  // Conversion rate drop with stable traffic points at the landing page or the offer.
  if (
    baseline.conversionRate !== null &&
    current.conversionRate !== null &&
    baseline.clicks >= 100 &&
    current.clicks >= 50
  ) {
    const rateChange = safePercentChange(current.conversionRate, baseline.conversionRate);
    if (rateChange !== null && rateChange <= -35) {
      findings.push({
        ...entity,
        type: "CONVERSION_RATE_DROP",
        metric: "conversionRate",
        severity: "WARNING",
        title: `Conversion rate dropped ${Math.abs(Math.round(rateChange))}%`,
        description: `${(current.conversionRate * 100).toFixed(2)}% of clicks converted in the last 7 days against ${(
          baseline.conversionRate * 100
        ).toFixed(2)}% the week before, on similar traffic. Check the landing page and the offer.`,
        currentValue: current.conversionRate,
        baselineValue: baseline.conversionRate,
        changePct: rateChange,
      });
    }
  }

  return findings;
}

async function campaignChecks(
  organizationId: string,
  accountId: string,
  current: { start: string; end: string },
  baseline: { start: string; end: string },
): Promise<Detected[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId, accountId, status: { not: "REMOVED" } },
    select: { id: true, campaignId: true, name: true, status: true },
  });
  if (campaigns.length === 0) return [];

  const [currentRows, baselineRows] = await Promise.all([
    campaignSums(organizationId, accountId, current),
    campaignSums(organizationId, accountId, baseline),
  ]);

  const findings: Detected[] = [];

  for (const campaign of campaigns) {
    const now = currentRows.get(campaign.id) ?? { cost: 0, conversions: 0 };
    const before = baselineRows.get(campaign.id) ?? { cost: 0, conversions: 0 };

    // A campaign that was spending and has gone silent while still enabled is either
    // paused upstream, out of budget, or disapproved. Worth surfacing immediately.
    if (before.cost >= 50 && now.cost <= before.cost * 0.05 && campaign.status === "ENABLED") {
      findings.push({
        type: "CAMPAIGN_STOPPED",
        metric: "cost",
        entityType: "CAMPAIGN",
        entityId: campaign.campaignId,
        entityName: campaign.name,
        severity: "CRITICAL",
        title: `${campaign.name} stopped spending`,
        description: `This campaign spent ${before.cost.toFixed(
          2,
        )} the previous week and almost nothing since. It is still marked enabled, so check for disapproved ads, an exhausted shared budget, or a paused ad group.`,
        currentValue: now.cost,
        baselineValue: before.cost,
        changePct: safePercentChange(now.cost, before.cost) ?? -100,
      });
    }
  }

  return findings;
}

async function campaignSums(
  organizationId: string,
  accountId: string,
  range: { start: string; end: string },
): Promise<Map<string, { cost: number; conversions: number }>> {
  const rows = await prisma.dailyMetric.groupBy({
    by: ["campaignRowId"],
    where: {
      organizationId,
      accountId,
      level: "CAMPAIGN",
      date: rangeToDates(range),
    },
    _sum: { costMicros: true, conversions: true },
  });

  const map = new Map<string, { cost: number; conversions: number }>();
  for (const row of rows) {
    if (!row.campaignRowId) continue;
    map.set(row.campaignRowId, {
      cost: toNumber(row._sum.costMicros ?? 0) / 1_000_000,
      conversions: row._sum.conversions ?? 0,
    });
  }
  return map;
}

function notificationTypeFor(type: string) {
  switch (type) {
    case "SPEND_SPIKE":
      return "SPEND_SPIKE" as const;
    case "ROAS_DROP":
      return "ROAS_DROP" as const;
    case "TRACKING_ISSUE":
      return "TRACKING_ISSUE" as const;
    default:
      return "ANOMALY" as const;
  }
}

export async function acknowledgeAnomaly(
  organizationId: string,
  anomalyId: string,
): Promise<void> {
  await prisma.anomaly.updateMany({
    where: { id: anomalyId, organizationId, status: "OPEN" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
  });
}

export async function listOpenAnomalies(organizationId: string, accountId: string) {
  const rows = await prisma.anomaly.findMany({
    where: { organizationId, accountId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    metric: row.metric,
    entityName: row.entityName,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    changePct: Number(row.changePct),
    periodStart: toDateKey(row.periodStart),
    periodEnd: toDateKey(row.periodEnd),
    createdAt: row.createdAt,
  }));
}
