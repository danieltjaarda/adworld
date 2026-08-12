import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { ReanalyzeButton } from "@/app/(dashboard)/recommendations/reanalyze-button";
import { typeLabel } from "@/components/ai/recommendation-card";
import { MetricCard, MetricGrid } from "@/components/dashboard/metric-card";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import {
  currencySymbol,
  formatCurrency,
  formatNumber,
  formatRelativeTime,
} from "@/lib/analytics/format";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "AI optimizer" };

const MODE_LABEL: Record<string, string> = {
  SUGGESTIONS: "Suggestions only",
  APPROVAL: "Approval required",
  AUTOMATIC: "Automatic",
};

const MODE_EXPLANATION: Record<string, string> = {
  SUGGESTIONS:
    "The optimizer analyses and explains, but nothing is ever written to Google Ads. Read-only.",
  APPROVAL: "Changes are prepared and wait in the action center until someone approves them.",
  AUTOMATIC:
    "The change types you enabled are applied on their own, within your limits. Everything else waits for approval.",
};

const JOB_LABEL: Record<string, string> = {
  SYNC_ACCOUNT: "Synced Google Ads data",
  ANALYZE_ACCOUNT: "Ran analysis",
  DETECT_ANOMALIES: "Checked for anomalies",
  EXECUTE_ACTIONS: "Applied queued changes",
  SEND_DIGEST: "Sent the weekly report",
};

export default async function OptimizerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, account, settings, currency } = await loadPageContext(params);

  const since = daysAgo(30);

  const [pendingByType, appliedCount, pendingImpact, savedImpact, runs] = await Promise.all([
    prisma.aIRecommendation.groupBy({
      by: ["type"],
      where: { ...scope, status: "PENDING" },
      _count: { _all: true },
      _sum: { estimatedMonthlyImpact: true },
    }),
    prisma.aIAction.count({
      where: { ...scope, status: "SUCCEEDED", executedAt: { gte: since } },
    }),
    prisma.aIRecommendation.aggregate({
      where: { ...scope, status: "PENDING" },
      _sum: { estimatedMonthlyImpact: true },
    }),
    prisma.aIRecommendation.aggregate({
      where: { ...scope, status: "EXECUTED", reviewedAt: { gte: since } },
      _sum: { estimatedMonthlyImpact: true },
    }),
    prisma.jobRun.findMany({
      where: { accountId: account.id },
      orderBy: { startedAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        status: true,
        startedAt: true,
        durationMs: true,
        stats: true,
        error: true,
      },
    }),
  ]);

  const automations = [
    { label: "Negative keywords", on: settings.autoNegativeKeywords },
    { label: "Budget changes", on: settings.autoBudgetChanges },
    { label: "Bid changes", on: settings.autoBidChanges },
    { label: "Keyword additions", on: settings.autoAddKeywords },
    { label: "Pause keywords", on: settings.autoPauseKeywords },
    { label: "Pause ads", on: settings.autoPauseAds },
  ];

  const pendingTotal = pendingByType.reduce((sum, row) => sum + row._count._all, 0);
  const symbol = currencySymbol(currency);

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI optimizer"
        description={`How the optimizer is configured for ${account.descriptiveName}, and what it has been doing.`}
        actions={<ReanalyzeButton />}
      />

      <MetricGrid className="md:grid-cols-4 xl:grid-cols-4">
        <MetricCard label="Mode" value={MODE_LABEL[settings.mode] ?? settings.mode} emphasis />
        <MetricCard label="Waiting for review" value={formatNumber(pendingTotal)} />
        <MetricCard
          label="Applied (30 days)"
          value={formatNumber(appliedCount)}
          hint="Changes written to Google Ads"
        />
        <MetricCard
          label="Impact on the table"
          value={formatCurrency(Number(pendingImpact._sum.estimatedMonthlyImpact ?? 0), currency)}
          hint="Estimated monthly, from pending changes"
        />
      </MetricGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Surface padded={false}>
            <SurfaceHeader>
              <SectionHeader
                title="What the optimizer found"
                description="Open recommendations grouped by the kind of change."
              />
              <Button asChild variant="outline" size="sm">
                <Link href="/recommendations">
                  Review
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </SurfaceHeader>

            {pendingByType.length === 0 ? (
              <EmptyState
                title="Nothing open"
                description="Every change the optimizer proposed has been reviewed. It looks again after each sync."
              />
            ) : (
              <ul className="divide-y divide-border">
                {pendingByType
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((row) => (
                    <li key={row.type} className="flex items-center gap-3 px-5 py-3">
                      <span className="flex-1 text-[13px] font-medium">{typeLabel(row.type)}</span>
                      <span className="tabular text-[12px] text-muted-foreground">
                        {row._sum.estimatedMonthlyImpact
                          ? `${formatCurrency(Number(row._sum.estimatedMonthlyImpact), currency)}/mo`
                          : ""}
                      </span>
                      <span className="tabular text-[13px] font-medium">{row._count._all}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader>
              <SectionHeader
                title="Activity"
                description="Scheduled work on this account. Runs are idempotent, so a retry never doubles up."
              />
            </SurfaceHeader>

            {runs.length === 0 ? (
              <EmptyState
                title="No runs yet"
                description="Syncs and analyses appear here once the first scheduled job has run."
              />
            ) : (
              <ul className="divide-y divide-border">
                {runs.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{JOB_LABEL[run.type] ?? run.type}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {formatRelativeTime(run.startedAt)}
                        {run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}
                        {run.error ? ` · ${run.error}` : describeStats(run.stats)}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        run.status === "SUCCEEDED"
                          ? "positive"
                          : run.status === "RUNNING"
                            ? "info"
                            : "negative"
                      }
                    >
                      {run.status.toLowerCase()}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>

        <div className="space-y-5">
          <Surface>
            <SectionHeader title="Mode" />
            <p className="mt-2 text-[13px] font-medium">{MODE_LABEL[settings.mode]}</p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {MODE_EXPLANATION[settings.mode]}
            </p>

            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Runs automatically
              </p>
              {settings.mode === "AUTOMATIC" ? (
                <ul className="space-y-1.5">
                  {automations.map((automation) => (
                    <li key={automation.label} className="flex items-center justify-between gap-2">
                      <span className="text-[12px]">{automation.label}</span>
                      <StatusBadge tone={automation.on ? "positive" : "neutral"}>
                        {automation.on ? "On" : "Off"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] leading-5 text-muted-foreground">
                  Nothing. Every change waits for a person in this mode.
                </p>
              )}
            </div>

            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link href="/settings/optimization">Change settings</Link>
            </Button>
          </Surface>

          <Surface>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-positive" />
              <SectionHeader title="Limits in force" />
            </div>

            <dl className="mt-3 space-y-2">
              <Limit label="Budget increase" value={`max ${settings.maxDailyBudgetIncreasePct}%`} />
              <Limit label="Budget decrease" value={`max ${settings.maxDailyBudgetDecreasePct}%`} />
              <Limit label="Bid change" value={`max ${settings.maxBidChangePct}%`} />
              <Limit label="Changes per run" value={String(settings.maxActionsPerRun)} />
              <Limit
                label="Daily budget ceiling"
                value={
                  settings.maxDailyBudget
                    ? `${symbol}${formatNumber(settings.maxDailyBudget)}`
                    : "Not set"
                }
              />
              <Limit
                label="Minimum evidence"
                value={`${settings.minClicksForDecision} clicks · ${symbol}${formatNumber(settings.minSpendForDecision)}`}
              />
              <Limit
                label="Minimum confidence"
                value={`${Math.round(settings.minConfidence * 100)}%`}
              />
            </dl>

            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              Campaigns, ad groups and keywords are never deleted, and conversion tracking is never
              touched.
            </p>
          </Surface>

          <Surface>
            <SectionHeader title="Recovered so far" />
            <p className="tabular mt-2 text-[22px] font-semibold tracking-[-0.02em]">
              {formatCurrency(Number(savedImpact._sum.estimatedMonthlyImpact ?? 0), currency)}
            </p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              Estimated monthly impact of the changes applied in the last 30 days. An estimate from
              the data at the time of each change, not a guarantee.
            </p>
          </Surface>
        </div>
      </div>
    </div>
  );
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="tabular text-[12px] font-medium">{value}</dd>
    </div>
  );
}

/** Job stats are free-form JSON; show the couple of counters that are worth reading. */
function describeStats(stats: unknown): string {
  if (!stats || typeof stats !== "object") return "";
  const data = stats as Record<string, unknown>;

  const parts: string[] = [];
  const add = (key: string, label: string) => {
    const value = data[key];
    if (typeof value === "number" && value > 0) parts.push(`${value} ${label}`);
  };

  add("created", "new");
  add("autoQueued", "applied");
  add("campaigns", "campaigns");
  add("keywords", "keywords");
  add("searchTerms", "search terms");
  add("detected", "anomalies");

  return parts.length > 0 ? ` · ${parts.join(", ")}` : "";
}
