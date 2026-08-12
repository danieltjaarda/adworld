"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { reanalyzeAction } from "@/app/(dashboard)/recommendations/actions";
import { Button } from "@/components/ui/button";

export function ReanalyzeButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reanalyzeAction();
          if (result.status === "success") {
            toast.success("Analysis complete", { description: result.message });
            router.refresh();
          } else {
            toast.error("Analysis failed", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      {pending ? "Analyzing…" : "Run analysis"}
    </Button>
  );
}
