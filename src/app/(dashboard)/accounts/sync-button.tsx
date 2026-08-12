"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { syncAccountAction } from "@/app/(dashboard)/accounts/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SyncButton({
  accountId,
  label = "Sync",
  variant = "outline",
}: {
  accountId: string;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await syncAccountAction(accountId);
      if (result.status === "success") {
        toast.success("Sync complete", { description: result.message });
        router.refresh();
      } else {
        toast.error("Sync failed", { description: result.message });
      }
    });
  }

  return (
    <Button variant={variant} size="sm" onClick={run} disabled={pending} className="h-8 gap-1.5">
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      {pending ? "Syncing…" : label}
    </Button>
  );
}
