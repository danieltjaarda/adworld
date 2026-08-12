"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { PlanTier } from "@/generated/prisma/enums";
import { startCheckoutAction } from "@/app/(dashboard)/billing/actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { PLANS, PLAN_ORDER } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export function PlanGrid({ current, canManage }: { current: PlanTier; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const currentIndex = PLAN_ORDER.indexOf(current);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {PLAN_ORDER.map((tier) => {
        const plan = PLANS[tier];
        const isCurrent = tier === current;
        const isUpgrade = PLAN_ORDER.indexOf(tier) > currentIndex;

        return (
          <div
            key={tier}
            className={cn(
              "flex flex-col rounded-xl border bg-card p-4 shadow-card",
              isCurrent ? "border-primary/40 ring-1 ring-primary/15" : "border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{plan.name}</h3>
              {isCurrent ? <StatusBadge tone="info">Current</StatusBadge> : null}
            </div>

            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{plan.tagline}</p>

            <p className="mt-3">
              <span className="tabular text-[22px] font-semibold tracking-[-0.02em]">
                {plan.indicativePrice === 0 ? "Free" : `€${plan.indicativePrice}`}
              </span>
              {plan.indicativePrice ? (
                <span className="text-[12px] text-muted-foreground"> /month</span>
              ) : null}
            </p>

            <ul className="mt-3 flex-1 space-y-1.5">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2 text-[12px] leading-5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-positive" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4">
              {isCurrent ? (
                <Button variant="outline" className="w-full" disabled>
                  Current plan
                </Button>
              ) : tier === "FREE" ? (
                <Button variant="ghost" className="w-full" disabled>
                  Downgrade via billing portal
                </Button>
              ) : (
                <Button
                  variant={isUpgrade ? "default" : "outline"}
                  className="w-full"
                  disabled={pending || !canManage}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await startCheckoutAction(tier);
                      if (result.status === "error") {
                        toast.error("Could not start checkout", { description: result.message });
                      }
                    })
                  }
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
