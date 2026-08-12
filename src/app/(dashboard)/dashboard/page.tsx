import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Lightbulb, RefreshCw } from "lucide-react";

import { SyncButton } from "@/app/(dashboard)/accounts/sync-button";
import { AccountSummaryCard } from "@/components/ai/summary-card";
import { PerformanceChart } from "@/components/charts/performance-chart";
import { MetricCard, MetricGrid } from "@/components/dashboard/metric-card";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { RangePicker } from "@/components/dashboard/range-picker";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { CellStack, DataTable, NumberCell } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { getAccountSummary } from "@/lib/ai/summary";
import { formatCurrency, formatDecimal, formatRatio, formatRelativeTime } from "@/lib/analytics/format";
import {
  getCampaignPerformance,
  getPeriodComparison,
  getSearchTermPerformance,
  getTimeSeries,
  type CampaignPerformance,
} from "@/lib/analytics/queries";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Overview" };

/**
 * The overview answers four questions in order: how are we doing, what does the AI
 * make of it, what is broken, and what should I do about it.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { auth, account, scope, range, profitConfig, currency, settings } =
    await loadPageContext(params);

  if (!account.lastSyncedAt) {
    return <AwaitingFirstSync accountName={account.descriptiveName} accountId={account.id} />;
  }

  const [comparison, series, campaigns, searchTerms, summary, recommendations, anomalies] =
    await Promise.all([
      getPeriodComparison(scope, range, profitConfig),
      getTimeSeries(scope, range, profitConfig),
      getCampaignPerformance(scope, range, profitConfig),
      getSearchTermPerformance(scope, profitConfig, { limit: 60, onlyUnconverted: true }),
      getAccountSummary(auth.organization.id, account.id),
      prisma.aIRecommendation.findMany({
        where: { ...scope, status: "PENDING" },
        orderBy: [{ priority: "desc" }, { estimatedMonthlyImpact: "desc" }],
        take: 4,
        select: {
          id: true,
          title: true,
          targetName: true,
          reason: true,
          risk: true,
          estimatedMonthlyImpact: true,
        },
      }),
      prisma.anomaly.findMany({
        where: { ...scope, status: "OPEN" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 3,
        select: { id: true, title: true, description: true, severity: true },
      }),
    ]);

  const { current, currentProfit, deltas } = comparison;
  const hasProfitModel = settings.grossMarginPct !== null || settings.leadValue !== null;

  const wastedSpend = searchTerms.reduce((total, term) => total + term.metrics.cost, 0);
  const budgetLimited = campaigns.filter((campaign) => campaign.isBudgetLimited);
  const topCampaigns = [...campaigns].sort((a, b) => b.metrics.cost - a.metrics.cost).slice(0, 6);

  return (
    <div className="space-y-5">
      <PageHeader
        title={account.descriptiveName}
        description={`${range.label} · last synced ${formatRelativeTime(account.lastSyncedAt)}`}
        actions={
          <>
            <RangePicker preset={range.preset} start={range.start} end={range.end} />
            <SyncButton accountId={account.id} />
          </>
        }
      />

      <MetricGrid>
        <MetricCard
          label="Spend"
          value={formatCurrency(current.cost, currency)}
          delta={deltas.cost}
        />
        <MetricCard
          label="Conversions"
          value={formatDecimal(current.conversions, 1)}
          delta={deltas.conversions}
        />
        <MetricCard
          label="Revenue"
          value={formatCurrency(current.conversionValue, currency)}
          delta={deltas.conversionValue}
        />
        <MetricCard
          label="ROAS"
          value={formatRatio(current.roas)}
          delta={deltas.roas}
          emphasis
        />
        <MetricCard label="CPA" value={formatCurrency(current.cpa, currency)} delta={deltas.cpa} />
        <MetricCard
          label={hasProfitModel ? "Profit" : "Conv. rate"}
          value={
            hasProfitModel
              ? formatCurrency(currentProfit.netProfit, currency)
              : current.conversionRate === null
                ? "—"
                : `${(current.conversionRate * 100).toFixed(2)}%`
          }
          delta={hasProfitModel ? deltas.profit : deltas.conversionRate}
          hint={hasProfitModel ? undefined : "Set a margin to see profit"}
        />
      </MetricGrid>

      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader
            title="Performance"
            description={`${range.start} → ${range.end} compared with ${comparison.comparison.start} → ${comparison.comparison.end}`}
          />
        </SurfaceHeader>
        <PerformanceChart
          data={series.map((point) => ({
            date: point.date,
            cost: point.cost,
            conversions: point.conversions,
            conversionValue: point.conversionValue,
            roas: point.roas,
            cpa: point.cpa,
            profit: point.profit,
          }))}
          currency={currency}
          showProfit={hasProfitModel}
        />
      </Surface>

      <AccountSummaryCard summary={summary} accountName={account.descriptiveName} />

      {anomalies.length > 0 ? (
        <Surface padded={false}>
          <SurfaceHeader>
            <SectionHeader title="What needs attention" />
            <Button asChild variant="ghost" size="sm">
              <Link href="/alerts">
                All alerts
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </SurfaceHeader>
          <ul className="divide-y divide-border">
            {anomalies.map((anomaly) => (
              <li key={anomaly.id} className="flex gap-3 px-5 py-3.5">
                <AlertTriangle
                  className={`mt-0.5 size-4 shrink-0 ${
                    anomaly.severity === "CRITICAL" ? "text-negative" : "text-warning"
                  }`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{anomaly.title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                    {anomaly.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Surface padded={false}>
          <SurfaceHeader>
            <SectionHeader title="Campaigns" description={`${campaigns.length} active`} />
            <Button asChild variant="ghost" size="sm">
              <Link href="/campaigns">
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </SurfaceHeader>

          <DataTable<CampaignPerformance>
            columns={[
              {
                key: "name",
                header: "Campaign",
                render: (row) => (
                  <CellStack
                    primary={row.name}
                    secondary={
                      row.isBudgetLimited
                        ? `Limited by budget · ${formatCurrency(row.budget, currency)}/day`
                        : `${formatCurrency(row.budget, currency)}/day`
                    }
                  />
                ),
              },
              {
                key: "cost",
                header: "Spend",
                align: "right",
                render: (row) => <NumberCell value={formatCurrency(row.metrics.cost, currency)} />,
              },
              {
                key: "conversions",
                header: "Conv.",
                align: "right",
                hideBelow: "sm",
                render: (row) => <NumberCell value={formatDecimal(row.metrics.conversions, 1)} />,
              },
              {
                key: "roas",
                header: "ROAS",
                align: "right",
                render: (row) => (
                  <NumberCell
                    value={formatRatio(row.metrics.roas)}
                    className={
                      settings.targetRoas && row.metrics.roas
                        ? row.metrics.roas >= settings.targetRoas
                          ? "text-positive"
                          : "text-negative"
                        : undefined
                    }
                  />
                ),
              },
            ]}
            rows={topCampaigns}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                title="No campaigns yet"
                description="Once this account has campaigns they appear here with spend, conversions and ROAS."
              />
            }
          />
        </Surface>

        <div className="space-y-5">
          <Surface padded={false}>
            <SurfaceHeader>
              <SectionHeader title="Recommendations" />
              <Button asChild variant="ghost" size="sm">
                <Link href="/recommendations">
                  All
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </SurfaceHeader>

            {recommendations.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="Nothing to change right now"
                description="The optimizer reviews this account on every sync and posts changes worth making here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recommendations.map((recommendation) => (
                  <li key={recommendation.id} className="px-5 py-3.5">
                    <Link href="/recommendations" className="group block">
                      <p className="text-[13px] font-medium group-hover:text-primary">
                        {recommendation.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                        {recommendation.reason}
                      </p>
                      {recommendation.estimatedMonthlyImpact ? (
                        <p className="mt-1.5 text-[12px] font-medium text-positive">
                          {formatCurrency(Number(recommendation.estimatedMonthlyImpact), currency)}{" "}
                          estimated monthly impact
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface>
            <SectionHeader title="Where the money is leaking" />
            <dl className="mt-3 space-y-3">
              <Leak
                label="Search terms with no conversions"
                value={formatCurrency(wastedSpend, currency)}
                detail={`${searchTerms.length} terms in the current window`}
                href="/search-terms"
              />
              <Leak
                label="Campaigns capped by budget"
                value={String(budgetLimited.length)}
                detail={
                  budgetLimited.length > 0
                    ? budgetLimited
                        .slice(0, 2)
                        .map((campaign) => campaign.name)
                        .join(", ")
                    : "None right now"
                }
                href="/campaigns"
              />
            </dl>
          </Surface>
        </div>
      </div>
    </div>
  );
}

function Leak({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[13px] font-medium">{label}</dt>
        <dd className="mt-0.5 truncate text-[12px] text-muted-foreground">{detail}</dd>
      </div>
      <Link href={href} className="tabular shrink-0 text-[15px] font-semibold hover:text-primary">
        {value}
      </Link>
    </div>
  );
}

function AwaitingFirstSync({
  accountName,
  accountId,
}: {
  accountName: string;
  accountId: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={accountName} description="Waiting for the first data sync." />
      <Surface>
        <EmptyState
          icon={RefreshCw}
          title="No data yet"
          description="We have not pulled anything from Google Ads for this account. A sync takes under a minute for most accounts, and afterwards the dashboard fills in automatically."
          action={<SyncButton accountId={accountId} label="Sync now" />}
        />
      </Surface>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <StatusBadge tone="info">Tip</StatusBadge>
        Syncs also run automatically in the background several times a day.
      </div>
    </div>
  );
}
