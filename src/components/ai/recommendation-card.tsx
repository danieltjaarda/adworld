"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  approveRecommendationAction,
  dismissRecommendationAction,
} from "@/app/(dashboard)/recommendations/actions";
import { RiskBadge, StatusBadge, type Tone } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { typeLabel } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

/**
 * One proposed change, with everything needed to judge it: what, why, the numbers
 * behind it, how confident the system is and what it expects to happen.
 */

export type RecommendationView = {
  id: string;
  type: string;
  title: string;
  reason: string;
  expectedImpact: string;
  targetName: string;
  targetType: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
  priority: number;
  source: string;
  estimatedMonthlyImpact: string | null;
  evidence: { label: string; value: string }[];
  createdAt: string;
};

const TYPE_TONE: Record<string, Tone> = {
  INCREASE_BUDGET: "positive",
  ADD_KEYWORD: "positive",
  ENABLE_KEYWORD: "positive",
  INCREASE_KEYWORD_BID: "positive",
  DECREASE_BUDGET: "warning",
  DECREASE_KEYWORD_BID: "warning",
  CHANGE_MATCH_TYPE: "warning",
  MONITOR: "neutral",
  REVIEW_CONVERSION_TRACKING: "warning",
  ADD_NEGATIVE_KEYWORD: "negative",
  PAUSE_KEYWORD: "negative",
  PAUSE_AD: "negative",
  PAUSE_CAMPAIGN: "negative",
  CREATE_AD_VARIANT: "info",
};

export function RecommendationCard({
  recommendation,
  canReview,
  blockedReason,
  selected,
  onSelectedChange,
}: {
  recommendation: RecommendationView;
  canReview: boolean;
  blockedReason?: string;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  function approve() {
    setBusy("approve");
    startTransition(async () => {
      const result = await approveRecommendationAction(recommendation.id);
      setBusy(null);
      if (result.status === "success") {
        toast.success("Applied", { description: result.message });
        router.refresh();
      } else {
        toast.error("Not applied", { description: result.message });
      }
    });
  }

  function dismiss(decision: "reject" | "ignore") {
    setBusy("reject");
    startTransition(async () => {
      const result = await dismissRecommendationAction({
        recommendationId: recommendation.id,
        decision,
      });
      setBusy(null);
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Could not update", { description: result.message });
      }
    });
  }

  return (
    <article className="px-5 py-4">
      <div className="flex gap-3">
        {onSelectedChange ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelectedChange(value === true)}
            aria-label={`Select ${recommendation.title}`}
            className="mt-1"
            disabled={!canReview}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={TYPE_TONE[recommendation.type] ?? "neutral"}>
              {typeLabel(recommendation.type)}
            </StatusBadge>
            <RiskBadge risk={recommendation.risk} />
            <span className="text-[12px] text-muted-foreground">
              {Math.round(recommendation.confidence * 100)}% confidence
            </span>
            {recommendation.source === "USER" ? (
              <span className="text-[12px] text-muted-foreground">· requested</span>
            ) : null}
          </div>

          <h3 className="mt-1.5 text-[14px] leading-5 font-semibold">{recommendation.title}</h3>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {recommendation.reason}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {recommendation.estimatedMonthlyImpact ? (
              <span className="text-[13px] font-medium text-positive">
                {recommendation.estimatedMonthlyImpact} / month
              </span>
            ) : null}
            <span className="text-[12px] text-muted-foreground">
              {recommendation.expectedImpact}
            </span>
          </div>

          {expanded ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-muted px-3.5 py-3 sm:grid-cols-3">
              {recommendation.evidence.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
                  <dd className="tabular text-[12px] font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              disabled={!canReview || pending}
              title={canReview ? undefined : blockedReason}
              onClick={approve}
            >
              {busy === "approve" && pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canReview || pending}
              onClick={() => dismiss("reject")}
            >
              {busy === "reject" && pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canReview || pending}
              onClick={() => dismiss("ignore")}
            >
              Ignore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
              <ChevronDown
                className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Hide data" : "Supporting data"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
