import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, History } from "lucide-react";

import { ReanalyzeButton } from "@/app/(dashboard)/recommendations/reanalyze-button";
import { RecommendationList } from "@/app/(dashboard)/recommendations/recommendation-list";
import { UndoButton } from "@/app/(dashboard)/recommendations/undo-button";
import type { RecommendationView } from "@/components/ai/recommendation-card";
import { typeLabel } from "@/components/ai/recommendation-card";
import { MetricCard, MetricGrid } from "@/components/dashboard/metric-card";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState, Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatRatio,
  formatRelativeTime,
} from "@/lib/analytics/format";
import { can } from "@/lib/auth/rbac";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Recommendations" };

const MODE_COPY: Record<string, string> = {
  SUGGESTIONS:
    "This account is in Suggestions mode, so approving is disabled — nothing is written to Google Ads. Switch to Approval mode in settings to apply changes from here.",
  APPROVAL: "Approving applies the change to Google Ads immediately and logs it.",
  AUTOMATIC:
    "Automatic mode is on. The change types you enabled are applied on their own; everything else waits here.",
};

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { auth, scope, currency, settings, account } = await loadPageContext(params);

  const [pending, recentActions, counts] = await Promise.all([
    prisma.aIRecommendation.findMany({
      where: { ...scope, status: "PENDING" },
      orderBy: [{ priority: "desc" }, { estimatedMonthlyImpact: "desc" }, { createdAt: "desc" }],
      take: 60,
      select: {
        id: true,
        type: true,
        title: true,
        reason: true,
        expectedImpact: true,
        targetName: true,
        targetType: true,
        risk: true,
        confidence: true,
        priority: true,
        source: true,
        estimatedMonthlyImpact: true,
        evidence: true,
        createdAt: true,
      },
    }),
    prisma.aIAction.findMany({
      where: { ...scope, status: { in: ["SUCCEEDED", "FAILED", "ROLLED_BACK"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        targetName: true,
        status: true,
        actorType: true,
        executedAt: true,
        updatedAt: true,
        errorMessage: true,
        rollbackOfId: true,
      },
    }),
    prisma.aIRecommendation.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    }),
  ]);

  const countFor = (status: string) =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  const totalOpportunity = pending.reduce(
    (total, recommendation) => total + Number(recommendation.estimatedMonthlyImpact ?? 0),
    0,
  );

  const canReview = can(auth.role, "recommendations:review") && settings.mode !== "SUGGESTIONS";
  const blockedReason =
    settings.mode === "SUGGESTIONS"
      ? MODE_COPY.SUGGESTIONS
      : "Your role can view recommendations but not approve them.";

  const views: RecommendationView[] = pending.map((recommendation) => ({
    id: recommendation.id,
    type: recommendation.type,
    title: recommendation.title,
    reason: recommendation.reason,
    expectedImpact: recommendation.expectedImpact,
    targetName: recommendation.targetName,
    targetType: recommendation.targetType,
    risk: recommendation.risk,
    confidence: Number(recommendation.confidence),
    priority: recommendation.priority,
    source: recommendation.source,
    estimatedMonthlyImpact: recommendation.estimatedMonthlyImpact
      ? formatCurrency(Number(recommendation.estimatedMonthlyImpact), currency)
      : null,
    evidence: evidenceRows(recommendation.evidence, currency),
    createdAt: formatRelativeTime(recommendation.createdAt),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Action center"
        description={`${account.descriptiveName} · ${MODE_COPY[settings.mode]}`}
        actions={<ReanalyzeButton />}
      />

      <MetricGrid className="md:grid-cols-4 xl:grid-cols-4">
        <MetricCard label="Waiting for you" value={formatNumber(pending.length)} emphasis />
        <MetricCard
          label="Estimated monthly impact"
          value={formatCurrency(totalOpportunity, currency)}
          hint="From pending changes"
        />
        <MetricCard label="Applied" value={formatNumber(countFor("EXECUTED"))} />
        <MetricCard
          label="Dismissed"
          value={formatNumber(countFor("REJECTED") + countFor("IGNORED"))}
        />
      </MetricGrid>

      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader
            title="Recommendations"
            description={
              pending.length > 0
                ? "Highest impact first. Select several to apply them together."
                : undefined
            }
          />
          {settings.mode === "SUGGESTIONS" ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/optimization">Enable approvals</Link>
            </Button>
          ) : null}
        </SurfaceHeader>

        {views.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing needs your attention"
            description="The optimizer reviews this account after every sync. When it finds a change worth making, it appears here with the reasoning and the data behind it."
            action={<ReanalyzeButton />}
          />
        ) : (
          <RecommendationList
            recommendations={views}
            canReview={canReview}
            blockedReason={blockedReason}
          />
        )}
      </Surface>

      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader title="Recently applied" />
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/audit-log">
              <History className="size-3.5" />
              Full audit log
            </Link>
          </Button>
        </SurfaceHeader>

        {recentActions.length === 0 ? (
          <EmptyState
            title="No changes yet"
            description="Approved changes and anything applied automatically show up here, with a one-click undo."
          />
        ) : (
          <ul className="divide-y divide-border">
            {recentActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-medium">
                      {typeLabel(action.type)} · {action.targetName}
                    </p>
                    <StatusBadge
                      tone={
                        action.status === "SUCCEEDED"
                          ? "positive"
                          : action.status === "ROLLED_BACK"
                            ? "neutral"
                            : "negative"
                      }
                    >
                      {action.status === "ROLLED_BACK"
                        ? "undone"
                        : action.status.toLowerCase()}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {action.actorType === "AI" ? "AI Agent" : "You"} ·{" "}
                    {formatRelativeTime(action.executedAt ?? action.updatedAt)}
                    {action.errorMessage ? ` · ${action.errorMessage}` : ""}
                  </p>
                </div>

                {action.status === "SUCCEEDED" && !action.rollbackOfId ? (
                  <UndoButton actionId={action.id} disabled={!canReview} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

/** Evidence is stored as free-form JSON; render only the keys we understand. */
function evidenceRows(evidence: unknown, currency: string): { label: string; value: string }[] {
  if (!evidence || typeof evidence !== "object") return [];
  const data = evidence as Record<string, unknown>;

  const number = (key: string): number | null => {
    const value = data[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const rows: { label: string; value: string }[] = [
    { label: "Impressions", value: formatNumber(number("impressions")) },
    { label: "Clicks", value: formatNumber(number("clicks")) },
    { label: "Spend", value: formatCurrency(number("cost"), currency) },
    { label: "Conversions", value: formatDecimal(number("conversions"), 1) },
    { label: "CPA", value: formatCurrency(number("cpa"), currency) },
    { label: "ROAS", value: formatRatio(number("roas")) },
    { label: "CTR", value: formatPercent(number("ctr")) },
    { label: "Conv. rate", value: formatPercent(number("conversionRate")) },
  ].filter((row) => row.value !== "—");

  if (typeof data.windowStart === "string" && typeof data.windowEnd === "string") {
    rows.push({ label: "Window", value: `${data.windowStart} → ${data.windowEnd}` });
  }

  return rows;
}
