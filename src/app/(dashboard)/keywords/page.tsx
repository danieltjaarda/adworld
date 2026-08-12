import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, X } from "lucide-react";

import { SyncButton } from "@/app/(dashboard)/accounts/sync-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangePicker } from "@/components/dashboard/range-picker";
import { EntityStatusBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { CellStack, DataTable, NumberCell } from "@/components/tables/data-table";
import { FilterTabs, TableSearch } from "@/components/tables/table-toolbar";
import { TotalsRow } from "@/components/tables/totals-row";
import {
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatRatio,
} from "@/lib/analytics/format";
import {
  getCampaignPerformance,
  getKeywordPerformance,
  type KeywordPerformance,
} from "@/lib/analytics/queries";
import {
  loadPageContext,
  resolveSort,
  sortRows,
  withParams,
  type SearchParams,
} from "@/lib/dashboard/page-context";

export const metadata: Metadata = { title: "Keywords" };

const SORTABLE = [
  "name",
  "cost",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
  "cpa",
  "roas",
  "qualityScore",
] as const;

const MATCH_LABEL: Record<string, string> = {
  EXACT: "Exact",
  PHRASE: "Phrase",
  BROAD: "Broad",
};

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, range, profitConfig, currency, settings, account } = await loadPageContext(params);

  const campaignFilter = typeof params.campaign === "string" ? params.campaign : undefined;

  const [all, campaigns] = await Promise.all([
    getKeywordPerformance(scope, range, profitConfig, {
      campaignRowId: campaignFilter,
      limit: 1000,
    }),
    getCampaignPerformance(scope, range, profitConfig),
  ]);

  const activeCampaign = campaignFilter
    ? campaigns.find((campaign) => campaign.id === campaignFilter)
    : undefined;

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const view = typeof params.view === "string" ? params.view : "all";

  const spendNoConversion = (row: KeywordPerformance) =>
    row.metrics.conversions === 0 && row.metrics.cost >= settings.minSpendForDecision;

  const winners = (row: KeywordPerformance) =>
    row.metrics.conversions > 0 &&
    (settings.targetRoas
      ? (row.metrics.roas ?? 0) >= settings.targetRoas
      : (row.metrics.roas ?? 0) >= 1);

  const filtered = all.filter((keyword) => {
    if (query && !keyword.name.toLowerCase().includes(query)) return false;
    if (view === "wasting") return spendNoConversion(keyword);
    if (view === "winners") return winners(keyword);
    if (view === "paused") return keyword.status === "PAUSED";
    return true;
  });

  const sort = resolveSort(params, SORTABLE, { key: "cost", direction: "desc" });
  const rows = sortRows(filtered, sort, {
    name: (row) => row.name.toLowerCase(),
    cost: (row) => row.metrics.cost,
    clicks: (row) => row.metrics.clicks,
    ctr: (row) => row.metrics.ctr,
    cpc: (row) => row.metrics.cpc,
    conversions: (row) => row.metrics.conversions,
    cpa: (row) => row.metrics.cpa,
    roas: (row) => row.metrics.roas,
    qualityScore: (row) => row.qualityScore,
  }).slice(0, 500);

  const totals = filtered.reduce(
    (sum, row) => ({
      cost: sum.cost + row.metrics.cost,
      clicks: sum.clicks + row.metrics.clicks,
      conversions: sum.conversions + row.metrics.conversions,
      value: sum.value + row.metrics.conversionValue,
    }),
    { cost: 0, clicks: 0, conversions: 0, value: 0 },
  );

  const buildSortHref = (key: string, direction: "asc" | "desc") =>
    withParams("/keywords", params, { sort: key, dir: direction });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Keywords"
        description={`${all.length} active keywords · ${range.label}`}
        actions={
          <>
            <RangePicker preset={range.preset} start={range.start} end={range.end} />
            <SyncButton accountId={account.id} />
          </>
        }
      />

      {activeCampaign ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Filtered to</span>
          <Link
            href={withParams("/keywords", params, { campaign: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-medium hover:border-border-strong"
          >
            {activeCampaign.name}
            <X className="size-3 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      ) : null}

      <Surface padded={false}>
        <SurfaceHeader className="gap-3">
          <FilterTabs
            paramKey="view"
            active={view}
            options={[
              { value: "all", label: "All", count: all.length },
              { value: "winners", label: "Winners", count: all.filter(winners).length },
              {
                value: "wasting",
                label: "Spending, no conversions",
                count: all.filter(spendNoConversion).length,
              },
              {
                value: "paused",
                label: "Paused",
                count: all.filter((keyword) => keyword.status === "PAUSED").length,
              },
            ]}
          />
          <TableSearch placeholder="Search keywords" />
        </SurfaceHeader>

        <DataTable<KeywordPerformance>
          sort={sort}
          buildSortHref={buildSortHref}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "name",
              header: "Keyword",
              sortable: true,
              render: (row) => (
                <div className="flex min-w-0 items-center gap-2">
                  <CellStack
                    primary={row.name}
                    secondary={`${MATCH_LABEL[row.matchType] ?? row.matchType} · ${row.campaignName} › ${row.adGroupName}`}
                  />
                  {spendNoConversion(row) ? (
                    <StatusBadge tone="negative">No conv.</StatusBadge>
                  ) : null}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              hideBelow: "xl",
              width: "92px",
              render: (row) => <EntityStatusBadge status={row.status} />,
            },
            {
              key: "qualityScore",
              header: "QS",
              align: "right",
              sortable: true,
              hideBelow: "xl",
              width: "56px",
              render: (row) => (
                <NumberCell
                  value={row.qualityScore === null ? "—" : String(row.qualityScore)}
                  className={
                    row.qualityScore === null
                      ? undefined
                      : row.qualityScore >= 7
                        ? "text-positive"
                        : row.qualityScore <= 4
                          ? "text-negative"
                          : undefined
                  }
                />
              ),
            },
            {
              key: "cost",
              header: "Spend",
              align: "right",
              sortable: true,
              render: (row) => <NumberCell value={formatCurrency(row.metrics.cost, currency)} />,
            },
            {
              key: "clicks",
              header: "Clicks",
              align: "right",
              sortable: true,
              hideBelow: "md",
              render: (row) => <NumberCell value={formatNumber(row.metrics.clicks)} muted />,
            },
            {
              key: "ctr",
              header: "CTR",
              align: "right",
              sortable: true,
              hideBelow: "xl",
              render: (row) => (
                <NumberCell value={formatPercent(row.metrics.ctr, { decimals: 1 })} muted />
              ),
            },
            {
              key: "cpc",
              header: "CPC",
              align: "right",
              sortable: true,
              hideBelow: "lg",
              render: (row) => (
                <NumberCell value={formatCurrency(row.metrics.cpc, currency)} muted />
              ),
            },
            {
              key: "conversions",
              header: "Conv.",
              align: "right",
              sortable: true,
              render: (row) => <NumberCell value={formatDecimal(row.metrics.conversions, 1)} />,
            },
            {
              key: "cpa",
              header: "CPA",
              align: "right",
              sortable: true,
              hideBelow: "sm",
              render: (row) => (
                <NumberCell
                  value={formatCurrency(row.metrics.cpa, currency)}
                  className={
                    settings.targetCpa && row.metrics.cpa
                      ? row.metrics.cpa <= settings.targetCpa
                        ? "text-positive"
                        : "text-negative"
                      : undefined
                  }
                />
              ),
            },
            {
              key: "roas",
              header: "ROAS",
              align: "right",
              sortable: true,
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
          footer={
            <TotalsRow
              items={[
                { label: "Keywords", value: formatNumber(filtered.length) },
                { label: "Spend", value: formatCurrency(totals.cost, currency) },
                { label: "Clicks", value: formatNumber(totals.clicks) },
                { label: "Conversions", value: formatDecimal(totals.conversions, 1) },
                {
                  label: "ROAS",
                  value: formatRatio(totals.cost > 0 ? totals.value / totals.cost : null),
                },
                ...(rows.length < filtered.length
                  ? [{ label: "Showing", value: `top ${rows.length}` }]
                  : []),
              ]}
            />
          }
          emptyState={
            <EmptyState
              icon={KeyRound}
              title={query || view !== "all" ? "No keywords match" : "No keywords yet"}
              description={
                query || view !== "all"
                  ? "Try a different search, or switch back to All."
                  : "Keywords appear here after the first sync. The optimizer needs a few weeks of data before it starts proposing bid changes."
              }
            />
          }
        />
      </Surface>

      <p className="text-[12px] leading-5 text-muted-foreground">
        The optimizer only acts on keywords with at least {settings.minClicksForDecision} clicks,{" "}
        {formatNumber(settings.minImpressionsForDecision)} impressions and{" "}
        {formatCurrency(settings.minSpendForDecision, currency)} spend in the lookback window.
        Anything below that is shown here but treated as too small to judge.
      </p>
    </div>
  );
}
