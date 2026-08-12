import type { Metadata } from "next";
import { Printer } from "lucide-react";

import { PrintButton } from "@/app/(dashboard)/reports/print-button";
import { PerformanceChart } from "@/components/charts/performance-chart";
import { DeltaBadge } from "@/components/dashboard/delta";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { RangePicker } from "@/components/dashboard/range-picker";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { CellStack, DataTable, NumberCell } from "@/components/tables/data-table";
import {
  formatCurrency,
  formatDate,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatRatio,
  formatRelativeTime,
} from "@/lib/analytics/format";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";
import { buildReport, type ReportRow } from "@/lib/reports/builder";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, range, settings, currency, account } = await loadPageContext(params);

  if (!account.lastSyncedAt) {
    return (
      <div className="space-y-5">
        <PageHeader title="Reports" description={account.descriptiveName} />
        <Surface>
          <EmptyState
            title="No data to report on yet"
            description="Once the first sync finishes, this page assembles a full period report you can print or share."
          />
        </Surface>
      </div>
    );
  }

  const report = await buildReport(scope, range, settings);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={`${account.descriptiveName} · ${report.range.label}`}
        actions={
          <>
            <RangePicker preset={range.preset} start={range.start} end={range.end} />
            <PrintButton />
          </>
        }
      />

      <Surface className="print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
              {account.descriptiveName}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {formatDate(report.range.start)} – {formatDate(report.range.end)} · compared with{" "}
              {formatDate(report.comparison.start)} – {formatDate(report.comparison.end)}
            </p>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Generated {formatRelativeTime(new Date())} · data synced{" "}
            {formatRelativeTime(account.lastSyncedAt)}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Figure
            label="Spend"
            value={formatCurrency(report.current.cost, currency)}
            delta={report.deltas.cost}
          />
          <Figure
            label="Revenue"
            value={formatCurrency(report.current.conversionValue, currency)}
            delta={report.deltas.conversionValue}
          />
          <Figure
            label="Conversions"
            value={formatDecimal(report.current.conversions, 1)}
            delta={report.deltas.conversions}
          />
          <Figure
            label="ROAS"
            value={formatRatio(report.current.roas)}
            delta={report.deltas.roas}
          />
          <Figure
            label="CPA"
            value={formatCurrency(report.current.cpa, currency)}
            delta={report.deltas.cpa}
          />
          <Figure
            label={report.hasProfitModel ? "Profit" : "Conv. rate"}
            value={
              report.hasProfitModel
                ? formatCurrency(report.profit.netProfit, currency)
                : formatPercent(report.current.conversionRate)
            }
            delta={report.hasProfitModel ? report.deltas.profit : report.deltas.conversionRate}
          />
        </dl>
      </Surface>

      <Surface padded={false} className="print:break-inside-avoid">
        <SurfaceHeader>
          <SectionHeader title="Performance over time" />
        </SurfaceHeader>
        <PerformanceChart
          data={report.series.map((point) => ({
            date: point.date,
            cost: point.cost,
            conversions: point.conversions,
            conversionValue: point.conversionValue,
            roas: point.roas,
            cpa: point.cpa,
            profit: point.profit,
          }))}
          currency={currency}
          showProfit={report.hasProfitModel}
        />
      </Surface>

      <ReportTable
        title="Top campaigns"
        description="By revenue in the selected period"
        rows={report.topCampaigns}
        currency={currency}
        showProfit={report.hasProfitModel}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable
          title="Best keywords"
          description="Highest revenue"
          rows={report.topKeywords}
          currency={currency}
          showProfit={report.hasProfitModel}
          compact
        />
        <ReportTable
          title="Worst keywords"
          description="Spend without a single conversion"
          rows={report.worstKeywords}
          currency={currency}
          showProfit={report.hasProfitModel}
          compact
        />
      </div>

      <ReportTable
        title="Search term waste"
        description={`${formatCurrency(report.wastedSpend, currency)} on queries that never converted`}
        rows={report.wastedTerms}
        currency={currency}
        showProfit={report.hasProfitModel}
        compact
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader>
            <SectionHeader title="Devices" />
          </SurfaceHeader>
          {report.devices.length === 0 ? (
            <EmptyState
              title="No device breakdown"
              description="Device segments arrive with the next full sync."
            />
          ) : (
            <ul className="divide-y divide-border">
              {report.devices.map((device) => (
                <li
                  key={device.label}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span className="text-[13px]">{device.label}</span>
                  <span className="tabular flex items-center gap-4 text-[13px]">
                    <span className="text-muted-foreground">
                      {formatCurrency(device.cost, currency)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDecimal(device.conversions, 1)}
                    </span>
                    <span className="w-14 text-right font-medium">
                      {formatRatio(device.roas)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface padded={false}>
          <SurfaceHeader>
            <SectionHeader
              title="What the optimizer did"
              description={`${report.actions.applied} applied · ${report.actions.pending} waiting · ${report.actions.rejected} dismissed`}
            />
          </SurfaceHeader>
          {report.actions.recent.length === 0 ? (
            <EmptyState
              title="No changes applied yet"
              description="Approved and automatic changes are listed here for the record."
            />
          ) : (
            <ul className="divide-y divide-border">
              {report.actions.recent.map((action, index) => (
                <li key={`${action.title}-${index}`} className="px-5 py-2.5">
                  <p className="truncate text-[13px]">
                    {action.title} · <span className="text-muted-foreground">{action.targetName}</span>
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {action.actor} · {formatRelativeTime(action.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>

      <p className="flex items-center gap-2 text-[12px] text-muted-foreground print:hidden">
        <Printer className="size-3.5" aria-hidden />
        Use your browser&rsquo;s print dialog to save this report as a PDF. Scheduled email reports
        are configured per account in notification settings.
      </p>
    </div>
  );
}

function Figure({ label, value, delta }: { label: string; value: string; delta?: Parameters<typeof DeltaBadge>[0]["delta"] }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1 text-[20px] leading-7 font-semibold tracking-[-0.02em]">
        {value}
      </dd>
      {delta ? (
        <div className="mt-1">
          <DeltaBadge delta={delta} />
        </div>
      ) : null}
    </div>
  );
}

function ReportTable({
  title,
  description,
  rows,
  currency,
  showProfit,
  compact,
}: {
  title: string;
  description?: string;
  rows: ReportRow[];
  currency: string;
  showProfit: boolean;
  compact?: boolean;
}) {
  return (
    <Surface padded={false} className="print:break-inside-avoid">
      <SurfaceHeader>
        <SectionHeader title={title} description={description} />
      </SurfaceHeader>

      <DataTable<ReportRow>
        rows={rows}
        rowKey={(row) => `${title}-${row.name}`}
        columns={[
          {
            key: "name",
            header: "Name",
            render: (row) => <CellStack primary={row.name} secondary={row.detail} />,
          },
          {
            key: "cost",
            header: "Spend",
            align: "right",
            render: (row) => <NumberCell value={formatCurrency(row.cost, currency)} />,
          },
          ...(compact
            ? []
            : [
                {
                  key: "conversions",
                  header: "Conv.",
                  align: "right" as const,
                  render: (row: ReportRow) => (
                    <NumberCell value={formatDecimal(row.conversions, 1)} />
                  ),
                },
              ]),
          {
            key: "conversionValue",
            header: "Revenue",
            align: "right",
            hideBelow: "sm",
            render: (row) => <NumberCell value={formatCurrency(row.conversionValue, currency)} />,
          },
          {
            key: "roas",
            header: "ROAS",
            align: "right",
            render: (row) => <NumberCell value={formatRatio(row.roas)} />,
          },
          ...(showProfit
            ? [
                {
                  key: "profit",
                  header: "Profit",
                  align: "right" as const,
                  hideBelow: "md" as const,
                  render: (row: ReportRow) => (
                    <NumberCell
                      value={formatCurrency(row.profit, currency)}
                      className={row.profit < 0 ? "text-negative" : "text-positive"}
                    />
                  ),
                },
              ]
            : []),
        ]}
        emptyState={
          <EmptyState title="Nothing to show" description="No rows matched in this period." />
        }
        footer={
          rows.length > 0 ? (
            <span className="text-[12px] text-muted-foreground">
              {formatNumber(rows.length)} rows
            </span>
          ) : undefined
        }
      />
    </Surface>
  );
}
