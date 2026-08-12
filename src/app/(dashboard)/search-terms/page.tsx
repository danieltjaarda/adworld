import type { Metadata } from "next";
import { SearchX } from "lucide-react";

import { SyncButton } from "@/app/(dashboard)/accounts/sync-button";
import { SearchTermActions } from "@/app/(dashboard)/search-terms/term-actions";
import { MetricCard, MetricGrid } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge, type Tone } from "@/components/dashboard/status-badge";
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
import { getSearchTermPerformance, type SearchTermPerformance } from "@/lib/analytics/queries";
import { can } from "@/lib/auth/rbac";
import {
  loadPageContext,
  resolveSort,
  sortRows,
  withParams,
  type SearchParams,
} from "@/lib/dashboard/page-context";

export const metadata: Metadata = { title: "Search terms" };

const SORTABLE = ["text", "cost", "clicks", "ctr", "conversions", "cpa", "roas"] as const;

const INTENT_LABEL: Record<string, string> = {
  HIGH_INTENT: "High intent",
  MEDIUM_INTENT: "Medium intent",
  LOW_INTENT: "Low intent",
  IRRELEVANT: "Irrelevant",
  UNCLASSIFIED: "Unclassified",
};

const INTENT_TONE: Record<string, Tone> = {
  HIGH_INTENT: "positive",
  MEDIUM_INTENT: "info",
  LOW_INTENT: "warning",
  IRRELEVANT: "negative",
  UNCLASSIFIED: "neutral",
};

/**
 * The search term optimizer. Every row is a real query someone typed, classified by
 * intent, with the two changes worth making one click away.
 */
export default async function SearchTermsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { auth, scope, range, profitConfig, currency, settings, account } =
    await loadPageContext(params);

  const all = await getSearchTermPerformance(scope, profitConfig, { limit: 1000 });

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const view = typeof params.view === "string" ? params.view : "all";

  const isWaste = (term: SearchTermPerformance) =>
    term.metrics.conversions === 0 && term.metrics.cost > 0;
  const isConverting = (term: SearchTermPerformance) => term.metrics.conversions > 0;
  const isNegativeCandidate = (term: SearchTermPerformance) =>
    term.intent === "IRRELEVANT" || (isWaste(term) && term.metrics.clicks >= 5);

  const filtered = all.filter((term) => {
    if (query && !term.text.toLowerCase().includes(query)) return false;
    if (view === "waste") return isWaste(term);
    if (view === "converting") return isConverting(term);
    if (view === "negatives") return isNegativeCandidate(term);
    if (view === "high") return term.intent === "HIGH_INTENT";
    return true;
  });

  const sort = resolveSort(params, SORTABLE, { key: "cost", direction: "desc" });
  const rows = sortRows(filtered, sort, {
    text: (row) => row.text,
    cost: (row) => row.metrics.cost,
    clicks: (row) => row.metrics.clicks,
    ctr: (row) => row.metrics.ctr,
    conversions: (row) => row.metrics.conversions,
    cpa: (row) => row.metrics.cpa,
    roas: (row) => row.metrics.roas,
  }).slice(0, 300);

  const wastedSpend = all.filter(isWaste).reduce((total, term) => total + term.metrics.cost, 0);
  const convertingValue = all
    .filter(isConverting)
    .reduce((total, term) => total + term.metrics.conversionValue, 0);
  const notKeywords = all.filter(
    (term) => isConverting(term) && term.intent === "HIGH_INTENT",
  ).length;

  const totals = filtered.reduce(
    (sum, row) => ({
      cost: sum.cost + row.metrics.cost,
      clicks: sum.clicks + row.metrics.clicks,
      conversions: sum.conversions + row.metrics.conversions,
      value: sum.value + row.metrics.conversionValue,
    }),
    { cost: 0, clicks: 0, conversions: 0, value: 0 },
  );

  const canAct = can(auth.role, "actions:execute") && settings.mode !== "SUGGESTIONS";
  const blockedReason =
    settings.mode === "SUGGESTIONS"
      ? "This account is in Suggestions mode, so nothing is written to Google Ads."
      : "Your role cannot apply changes.";

  const buildSortHref = (key: string, direction: "asc" | "desc") =>
    withParams("/search-terms", params, { sort: key, dir: direction });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search terms"
        description={`What people actually typed · rolling ${settings.lookbackDays}-day window`}
        actions={<SyncButton accountId={account.id} />}
      />

      <MetricGrid className="md:grid-cols-3 xl:grid-cols-3">
        <MetricCard
          label="Spend without a conversion"
          value={formatCurrency(wastedSpend, currency)}
          hint={`${all.filter(isWaste).length} terms`}
        />
        <MetricCard
          label="Revenue from search terms"
          value={formatCurrency(convertingValue, currency)}
          hint={`${all.filter(isConverting).length} converting terms`}
        />
        <MetricCard
          label="High-intent, converting"
          value={formatNumber(notKeywords)}
          hint="Candidates to promote to keywords"
        />
      </MetricGrid>

      <Surface padded={false}>
        <SurfaceHeader className="gap-3">
          <FilterTabs
            paramKey="view"
            active={view}
            options={[
              { value: "all", label: "All", count: all.length },
              { value: "waste", label: "No conversions", count: all.filter(isWaste).length },
              {
                value: "converting",
                label: "Converting",
                count: all.filter(isConverting).length,
              },
              {
                value: "negatives",
                label: "Negative candidates",
                count: all.filter(isNegativeCandidate).length,
              },
              {
                value: "high",
                label: "High intent",
                count: all.filter((term) => term.intent === "HIGH_INTENT").length,
              },
            ]}
          />
          <TableSearch placeholder="Search terms" />
        </SurfaceHeader>

        <DataTable<SearchTermPerformance>
          sort={sort}
          buildSortHref={buildSortHref}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "text",
              header: "Search term",
              sortable: true,
              render: (row) => (
                <div className="flex min-w-0 items-start gap-2">
                  <CellStack
                    primary={row.text}
                    secondary={
                      row.triggeredKeyword
                        ? `Matched "${row.triggeredKeyword}" · ${row.adGroupName ?? row.campaignName ?? "—"}`
                        : (row.adGroupName ?? row.campaignName ?? "—")
                    }
                  />
                </div>
              ),
            },
            {
              key: "intent",
              header: "Intent",
              hideBelow: "md",
              width: "130px",
              render: (row) => (
                <span title={row.intentReason ?? undefined}>
                  <StatusBadge tone={INTENT_TONE[row.intent] ?? "neutral"}>
                    {INTENT_LABEL[row.intent] ?? row.intent}
                  </StatusBadge>
                </span>
              ),
            },
            {
              key: "cost",
              header: "Spend",
              align: "right",
              sortable: true,
              render: (row) => (
                <NumberCell
                  value={formatCurrency(row.metrics.cost, currency)}
                  className={isWaste(row) && row.metrics.cost > 20 ? "text-negative" : undefined}
                />
              ),
            },
            {
              key: "clicks",
              header: "Clicks",
              align: "right",
              sortable: true,
              hideBelow: "sm",
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
              key: "conversions",
              header: "Conv.",
              align: "right",
              sortable: true,
              render: (row) => <NumberCell value={formatDecimal(row.metrics.conversions, 1)} />,
            },
            {
              key: "roas",
              header: "ROAS",
              align: "right",
              sortable: true,
              hideBelow: "lg",
              render: (row) => <NumberCell value={formatRatio(row.metrics.roas)} />,
            },
            {
              key: "actions",
              header: "",
              align: "right",
              width: "132px",
              render: (row) => (
                <SearchTermActions
                  termId={row.id}
                  canAct={canAct}
                  hasAdGroup={row.googleAdGroupId !== null}
                  blockedReason={blockedReason}
                />
              ),
            },
          ]}
          footer={
            <TotalsRow
              items={[
                { label: "Terms", value: formatNumber(filtered.length) },
                { label: "Spend", value: formatCurrency(totals.cost, currency) },
                { label: "Clicks", value: formatNumber(totals.clicks) },
                { label: "Conversions", value: formatDecimal(totals.conversions, 1) },
                {
                  label: "ROAS",
                  value: formatRatio(totals.cost > 0 ? totals.value / totals.cost : null),
                },
              ]}
            />
          }
          emptyState={
            <EmptyState
              icon={SearchX}
              title={query || view !== "all" ? "No terms match" : "No search terms yet"}
              description={
                query || view !== "all"
                  ? "Try a different search, or switch back to All."
                  : "Search terms arrive with the first sync. Google only reports queries with enough volume, so very rare searches never appear."
              }
            />
          }
        />
      </Surface>

      {!canAct ? (
        <p className="text-[12px] leading-5 text-muted-foreground">{blockedReason}</p>
      ) : null}

      <p className="text-[12px] leading-5 text-muted-foreground">
        {range.label} is not applied here: Google reports search terms as a rolling aggregate, so
        this table always reflects the last {settings.lookbackDays} days of synced data.
      </p>
    </div>
  );
}
