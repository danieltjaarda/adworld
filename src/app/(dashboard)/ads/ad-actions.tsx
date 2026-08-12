"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, Loader2, PauseCircle, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";

import {
  generateVariantAction,
  pauseAdAction,
  publishVariantAction,
  reviewVariantAction,
} from "@/app/(dashboard)/ads/actions";
import { Button } from "@/components/ui/button";

type Result = { status: string; message: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<Result>, successTitle?: string) {
    startTransition(async () => {
      const result = await work();
      if (result.status === "success") {
        toast.success(successTitle ?? "Done", { description: result.message });
        router.refresh();
      } else {
        toast.error("That did not work", { description: result.message });
      }
    });
  }

  return { run, pending };
}

export function AdRowActions({
  adRowId,
  canAct,
  isPaused,
  blockedReason,
}: {
  adRowId: string;
  canAct: boolean;
  isPaused: boolean;
  blockedReason?: string;
}) {
  const { run, pending } = useRun();

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending || !canAct}
        title={canAct ? "Draft a new variant with the AI" : blockedReason}
        onClick={() => run(() => generateVariantAction(adRowId), "Draft ready")}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        <span className="hidden lg:inline">Variant</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Pause ad"
        title={canAct ? "Pause this ad" : blockedReason}
        disabled={pending || !canAct || isPaused}
        onClick={() => run(() => pauseAdAction(adRowId), "Ad paused")}
      >
        <PauseCircle className="size-4" />
      </Button>
    </div>
  );
}

export function VariantReviewActions({
  variantId,
  status,
  canAct,
}: {
  variantId: string;
  status: string;
  canAct: boolean;
}) {
  const { run, pending } = useRun();

  if (status === "APPROVED") {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          disabled={pending || !canAct}
          onClick={() => run(() => publishVariantAction(variantId), "Published")}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Publish to Google Ads
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !canAct}
        onClick={() => run(() => reviewVariantAction({ variantId, decision: "approve" }))}
      >
        <Check className="size-3.5" />
        Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || !canAct}
        onClick={() => run(() => reviewVariantAction({ variantId, decision: "reject" }))}
      >
        <X className="size-3.5" />
        Discard
      </Button>
    </div>
  );
}
