import Link from "next/link";
import { AlertTriangle, ArrowRight, Sparkles, TrendingUp, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { StoredSummary } from "@/lib/ai/summary";
import { formatRelativeTime } from "@/lib/analytics/format";

/**
 * The first thing a user reads. It answers "how are things, what is the opportunity,
 * what is the waste" before they have to interpret a single chart.
 */
export function AccountSummaryCard({
  summary,
  accountName,
}: {
  summary: StoredSummary | null;
  accountName: string;
}) {
  if (!summary) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-[14px] font-semibold">AI account summary</h2>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Once {accountName} finishes its first sync, a written summary of performance,
          opportunities and waste appears here.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-[14px] font-semibold">AI account summary</h2>
          {!summary.usedModel ? (
            <StatusBadge tone="neutral">Computed</StatusBadge>
          ) : null}
        </div>
        <span className="text-[12px] text-muted-foreground">
          {summary.rangeStart} → {summary.rangeEnd} · updated{" "}
          {formatRelativeTime(new Date(summary.generatedAt))}
        </span>
      </div>

      <div className="px-5 py-4">
        <p className="text-[15px] font-medium leading-6 tracking-[-0.008em] text-foreground">
          {summary.headline}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{summary.summary}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Insight
            icon={TrendingUp}
            tone="positive"
            label="Biggest opportunity"
            body={summary.biggestOpportunity}
          />
          <Insight icon={Wallet} tone="negative" label="Biggest waste" body={summary.biggestWaste} />
        </div>

        {summary.watchOut ? (
          <div className="mt-3 flex gap-2.5 rounded-lg border border-warning/20 bg-warning-soft px-3.5 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-[13px] leading-5 text-warning">{summary.watchOut}</p>
          </div>
        ) : null}

        {summary.insights.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
            {summary.insights.map((insight) => (
              <li key={insight} className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                {insight}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/recommendations">
              View AI analysis
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/ai">Ask a question</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Insight({
  icon: Icon,
  tone,
  label,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "positive" | "negative";
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon
          className={`size-3.5 ${tone === "positive" ? "text-positive" : "text-negative"}`}
          aria-hidden
        />
        <p className="text-[12px] font-medium uppercase tracking-[0.03em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-foreground">{body}</p>
    </div>
  );
}
