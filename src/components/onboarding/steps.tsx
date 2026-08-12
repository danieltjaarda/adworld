import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const ONBOARDING_STEPS = [
  { id: "connect", label: "Connect" },
  { id: "select", label: "Choose account" },
  { id: "mode", label: "Optimization mode" },
  { id: "goals", label: "Goals" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export function StepIndicator({ current }: { current: OnboardingStepId }) {
  const currentIndex = ONBOARDING_STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {ONBOARDING_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                done
                  ? "bg-primary text-primary-foreground"
                  : active
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "hidden text-[12px] font-medium sm:inline",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {index < ONBOARDING_STEPS.length - 1 ? (
              <span className="h-px w-4 bg-border sm:w-8" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
