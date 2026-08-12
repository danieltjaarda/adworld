"use client";

import { useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { openPortalAction } from "@/app/(dashboard)/billing/actions";
import { Button } from "@/components/ui/button";

export function BillingActions({
  canManage,
  hasCustomer,
  stripeConfigured,
}: {
  canManage: boolean;
  hasCustomer: boolean;
  stripeConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!canManage) {
    return (
      <p className="max-w-[220px] text-[12px] leading-5 text-muted-foreground">
        Only the workspace owner can change the plan or payment method.
      </p>
    );
  }

  if (!stripeConfigured || !hasCustomer) return null;

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await openPortalAction();
          if (result.status === "error") {
            toast.error("Could not open billing", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
      Manage billing
    </Button>
  );
}
