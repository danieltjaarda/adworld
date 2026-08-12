import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BellOff, Info, ShieldAlert } from "lucide-react";

import { AlertRowActions, RescanButton } from "@/app/(dashboard)/alerts/alert-actions";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import { formatPercent, formatRelativeTime } from "@/lib/analytics/format";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Alerts" };

const SEVERITY_ICON = {
  CRITICAL: ShieldAlert,
  WARNING: AlertTriangle,
  INFO: Info,
} as const;

const SEVERITY_CLASS = {
  CRITICAL: "text-negative",
  WARNING: "text-warning",
  INFO: "text-info",
} as const;

type Severity = keyof typeof SEVERITY_ICON;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, account } = await loadPageContext(params);

  const [open, resolved] = await Promise.all([
    prisma.anomaly.findMany({
      where: { ...scope, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        type: true,
        metric: true,
        entityName: true,
        entityType: true,
        severity: true,
        status: true,
        title: true,
        description: true,
        changePct: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
      },
    }),
    prisma.anomaly.findMany({
      where: { ...scope, status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      take: 8,
      select: { id: true, title: true, severity: true, resolvedAt: true },
    }),
  ]);

  const critical = open.filter((anomaly) => anomaly.severity === "CRITICAL").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description={`Automatic checks on ${account.descriptiveName}, comparing the last 7 days with the 7 before that.`}
        actions={<RescanButton />}
      />

      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader
            title="Open"
            description={
              open.length === 0
                ? undefined
                : `${open.length} open${critical > 0 ? `, ${critical} critical` : ""}`
            }
          />
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/notifications">Notification settings</Link>
          </Button>
        </SurfaceHeader>

        {open.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nothing looks wrong"
            description="We watch spend, CPC, conversions, conversion rate, ROAS and campaigns that stop serving. Every check has a volume floor, so small campaigns don't generate noise."
          />
        ) : (
          <ul className="divide-y divide-border">
            {open.map((anomaly) => {
              const severity = anomaly.severity as Severity;
              const Icon = SEVERITY_ICON[severity] ?? Info;
              const change = Number(anomaly.changePct);

              return (
                <li key={anomaly.id} className="flex flex-wrap gap-3 px-5 py-4">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${SEVERITY_CLASS[severity] ?? "text-info"}`}
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium">{anomaly.title}</p>
                      {anomaly.status === "ACKNOWLEDGED" ? (
                        <StatusBadge tone="neutral">Seen</StatusBadge>
                      ) : null}
                      <StatusBadge
                        tone={
                          severity === "CRITICAL"
                            ? "negative"
                            : severity === "WARNING"
                              ? "warning"
                              : "info"
                        }
                      >
                        {severity.toLowerCase()}
                      </StatusBadge>
                    </div>

                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                      {anomaly.description}
                    </p>

                    <p className="mt-1.5 text-[12px] text-muted-foreground">
                      {anomaly.entityName} · {anomaly.metric} {formatPercent(change / 100, { signed: true, decimals: 0 })} ·{" "}
                      {formatRelativeTime(anomaly.createdAt)}
                    </p>
                  </div>

                  <AlertRowActions anomalyId={anomaly.id} status={anomaly.status} />
                </li>
              );
            })}
          </ul>
        )}
      </Surface>

      {resolved.length > 0 ? (
        <Surface padded={false}>
          <SurfaceHeader>
            <SectionHeader title="Recently closed" />
          </SurfaceHeader>
          <ul className="divide-y divide-border">
            {resolved.map((anomaly) => (
              <li
                key={anomaly.id}
                className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]"
              >
                <span className="truncate text-muted-foreground">{anomaly.title}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {formatRelativeTime(anomaly.resolvedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </div>
  );
}
