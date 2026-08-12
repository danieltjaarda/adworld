import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

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
import { getCampaignPerformance, type CampaignPerformance } from "@/lib/analytics/queries";
import {
  loadPageContext,
  resolveSort,
  sortRows,
  withParams,
  type SearchParams,
} from "@/lib/dashboard/page-context";

export const metadata: Metadata = { title: "Campaigns" };

const SORTABLE = [
  "name",
  "cost",
  "conversions",
  "cpa",
  "conversionValue",
  "roas",
  "impressionShare",
] as const;

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Search",
  DISPLAY: "Display",
  SHOPPING: "Shopping",
  VIDEO: "Video",
  PERFORMANCE_MAX: "Performance Max",
  DEMAND_GEN: "Demand Gen",
  MULTI_CHANNEL: "Multi-channel",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, range, profitConfig, currency, settings, account } = await loadPageContext(params);

  const all = await getCampaignPerformance(scope, range, profitConfig);

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const filter = typeof params.status === "string" ? params.status : "all";

  const filtered = all.filter((campaign) => {
    if (query && !campaign.name.toLowerCase().includes(query)) return false;
    if (filter === "enabled") return campaign.status === "ENABLED";
    if (filter === "paused") return campaign.status === "PAUSED";
    if (filter === "limited") return campaign.isBudgetLimited;
    return true;
  });

  const sort = resolveSort(params, SORTABLE, { key: "cost", direction: "desc" });
  const rows = sortRows(filtered, sort, {
    name: (row) => row.name.toLowerCase(),
    cost: (row) => row.metrics.cost,
    conversions: (row) => row.metrics.conversions,
    cpa: (row) => row.metrics.cpa,
    conversionValue: (row) => row.metrics.conversionValue,
    roas: (row) => row.metrics.roas,
    impressionShare: (row) => row.impressionShare,
  });

  const totals = rows.reduce(
    (sum, row) => ({
      cost: sum.cost + row.metrics.cost,
      conversions: sum.conversions + row.metrics.conversions,
      value: sum.value + row.metrics.conversionValue,
      budget: sum.budget + row.budget,
    }),
    { cost: 0, conversions: 0, value: 0, budget: 0 },
  );

  const buildSortHref = (key: string, direction: "asc" | "desc") =>
    withParams("/campaigns", params, { sort: key, dir: direction });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description={`${all.length} campaigns · ${range.label}`}
        actions={
          <>
            <RangePicker preset={range.preset} start={range.start} end={range.end} />
            <SyncButton accountId={account.id} />
          </>
        }
      />

      <Surface padded={false}>
        <SurfaceHeader className="gap-3">
          <FilterTabs
            paramKey="status"
            active={filter}
            options={[
              { value: "all", label: "All", count: all.length },
              {
                value: "enabled",
                label: "Enabled",
                count: all.filter((campaign) => campaign.status === "ENABLED").length,
              },
              {
                value: "paused",
                label: "Paused",
                count: all.filter((campaign) => campaign.status === "PAUSED").length,
              },
              {
                value: "limited",
                label: "Budget limited",
                count: all.filter((campaign) => campaign.isBudgetLimited).length,
              },
            ]}
          />
          <TableSearch placeholder="Search campaigns" />
        </SurfaceHeader>

        <DataTable<CampaignPerformance>
          sort={sort}
          buildSortHref={buildSortHref}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "name",
              header: "Campaign",
              sortable: true,
              render: (row) => (
                <div className="flex min-w-0 items-center gap-2">
                  <CellStack
                    primary={
                      <Link
                        href={`/keywords?campaign=${row.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    }
                    secondary={`${CHANNEL_LABEL[row.advertisingChannel] ?? row.advertisingChannel} · ${formatCurrency(
                      row.budget,
                      currency,
                    )}/day${row.biddingStrategy ? ` · ${humanize(row.biddingStrategy)}` : ""}`}
                  />
                  {row.isBudgetLimited ? <StatusBadge tone="warning">Limited</StatusBadge> : null}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              hideBelow: "md",
              width: "96px",
              render: (row) => <EntityStatusBadge status={row.status} />,
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
              hideBelow: "lg",
              render: (row) => (
                <NumberCell value={formatNumber(row.metrics.clicks)} muted />
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
              key: "conversionValue",
              header: "Revenue",
              align: "right",
              sortable: true,
              hideBelow: "lg",
              render: (row) => (
                <NumberCell value={formatCurrency(row.metrics.conversionValue, currency)} />
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
            {
              key: "impressionShare",
              header: "Impr. share",
              align: "right",
              sortable: true,
              hideBelow: "xl",
              render: (row) => (
                <NumberCell
                  value={formatPercent(row.impressionShare, { decimals: 0 })}
                  muted
                  className={row.isBudgetLimited ? "text-warning" : undefined}
                />
              ),
            },
          ]}
          footer={
            <TotalsRow
              items={[
                { label: "Daily budget", value: `${formatCurrency(totals.budget, currency)}/day` },
                { label: "Spend", value: formatCurrency(totals.cost, currency) },
                { label: "Conversions", value: formatDecimal(totals.conversions, 1) },
                { label: "Revenue", value: formatCurrency(totals.value, currency) },
                {
                  label: "ROAS",
                  value: formatRatio(totals.cost > 0 ? totals.value / totals.cost : null),
                },
              ]}
            />
          }
          emptyState={
            <EmptyState
              icon={BarChart3}
              title={query || filter !== "all" ? "No campaigns match" : "No campaigns yet"}
              description={
                query || filter !== "all"
                  ? "Try a different search or clear the filter."
                  : "Campaigns appear here after the first sync, with spend, conversions and ROAS for the selected period."
              }
            />
          }
        />
      </Surface>
    </div>
  );
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
