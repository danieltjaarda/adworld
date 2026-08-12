import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";

import { SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface } from "@/components/dashboard/surface";
import { FilterTabs } from "@/components/tables/table-toolbar";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/analytics/format";
import { getAuthContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { withParams, type SearchParams } from "@/lib/dashboard/page-context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 40;

const FILTERS: Record<string, { label: string; prefix?: string }> = {
  all: { label: "Everything" },
  optimization: { label: "Optimizer", prefix: "optimization." },
  account: { label: "Accounts", prefix: "account." },
  settings: { label: "Settings", prefix: "settings." },
  team: { label: "Team", prefix: "team." },
  security: { label: "Security", prefix: "security." },
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  if (!can(context.role, "audit:read")) {
    return (
      <Surface>
        <EmptyState
          title="Not available for your role"
          description="Ask an owner or admin for access to the audit log."
        />
      </Surface>
    );
  }

  const params = await searchParams;
  const filter = typeof params.filter === "string" && FILTERS[params.filter] ? params.filter : "all";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const prefix = FILTERS[filter].prefix;

  const where = {
    organizationId: context.organization.id,
    ...(prefix ? { action: { startsWith: prefix } } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        action: true,
        actorType: true,
        actorLabel: true,
        entityType: true,
        summary: true,
        before: true,
        after: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Surface padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <SectionHeader
          title="Audit log"
          description="Every change made in this workspace, by a person or by the optimizer. Entries cannot be edited or deleted."
        />
      </div>

      <div className="border-t border-border px-5 py-2.5">
        <FilterTabs
          paramKey="filter"
          active={filter}
          options={Object.entries(FILTERS).map(([value, config]) => ({
            value,
            label: config.label,
          }))}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing logged yet"
          description="Connecting an account, approving a change or updating settings all leave a record here."
        />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px]">{entry.summary}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {entry.actorLabel ?? "System"} · {entry.action}
                    {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {entry.actorType === "AI" ? (
                    <StatusBadge tone="info">AI</StatusBadge>
                  ) : entry.actorType === "SYSTEM" ? (
                    <StatusBadge tone="neutral">System</StatusBadge>
                  ) : null}
                  <span className="tabular text-[12px] text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
              </div>

              {entry.before || entry.after ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">
                    Before and after
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <JsonBlock label="Before" value={entry.before} />
                    <JsonBlock label="After" value={entry.after} />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-[12px] text-muted-foreground">
            Page {page} of {pages} · {total} entries
          </p>
          <div className="flex gap-1.5">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <a href={withParams("/settings/audit-log", params, { page: String(page - 1) })}>
                Previous
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={page >= pages}>
              <a href={withParams("/settings/audit-log", params, { page: String(page + 1) })}>
                Next
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </Surface>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;

  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
