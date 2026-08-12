"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, Eye, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  acknowledgeAnomalyAction,
  rescanAnomaliesAction,
  resolveAnomalyAction,
} from "@/app/(dashboard)/alerts/actions";
import { Button } from "@/components/ui/button";

export function AlertRowActions({
  anomalyId,
  status,
}: {
  anomalyId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const result = await work();
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Could not update", { description: result.message });
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      {status === "OPEN" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => acknowledgeAnomalyAction(anomalyId))}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          Seen
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => resolveAnomalyAction(anomalyId))}
      >
        <Check className="size-3.5" />
        Close
      </Button>
    </div>
  );
}

export function RescanButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await rescanAnomaliesAction();
          if (result.status === "success") {
            toast.success("Scan complete", { description: result.message });
            router.refresh();
          } else {
            toast.error("Scan failed", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {pending ? "Scanning…" : "Scan now"}
    </Button>
  );
}
