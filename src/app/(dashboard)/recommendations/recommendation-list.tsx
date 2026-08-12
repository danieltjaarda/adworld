"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { approveManyAction } from "@/app/(dashboard)/recommendations/actions";
import {
  RecommendationCard,
  type RecommendationView,
} from "@/components/ai/recommendation-card";
import { Button } from "@/components/ui/button";

/**
 * Bulk approval lives here rather than on the card, because selecting several changes
 * and applying them together is the difference between a tool you use daily and one
 * you click through once.
 */
export function RecommendationList({
  recommendations,
  canReview,
  blockedReason,
}: {
  recommendations: RecommendationView[];
  canReview: boolean;
  blockedReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string, isSelected: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function approveSelected() {
    const ids = [...selected];
    startTransition(async () => {
      const result = await approveManyAction(ids);
      if (result.status === "success") {
        toast.success("Done", { description: result.message });
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error("Nothing was applied", { description: result.message });
      }
    });
  }

  return (
    <div>
      {selected.size > 0 ? (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/[0.04] px-5 py-2.5 backdrop-blur">
          <p className="text-[13px] font-medium">
            {selected.size} selected
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-2 font-normal text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
          </p>
          <Button size="sm" onClick={approveSelected} disabled={pending || !canReview}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Approve {selected.size}
          </Button>
        </div>
      ) : null}

      <div className="divide-y divide-border">
        {recommendations.map((recommendation) => (
          <RecommendationCard
            key={recommendation.id}
            recommendation={recommendation}
            canReview={canReview}
            blockedReason={blockedReason}
            selected={selected.has(recommendation.id)}
            onSelectedChange={(value) => toggle(recommendation.id, value)}
          />
        ))}
      </div>
    </div>
  );
}
