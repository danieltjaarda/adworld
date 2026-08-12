"use client";

import Link from "next/link";
import { useActionState } from "react";

import { saveOnboardingGoalsAction } from "@/app/onboarding/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { Button } from "@/components/ui/button";
import { currencySymbol } from "@/lib/analytics/format";

type Defaults = {
  targetRoas: number | null;
  targetCpa: number | null;
  maxDailyBudget: number | null;
  grossMarginPct: number | null;
  minProfitPerConversion: number | null;
  maxDailyBudgetIncreasePct: number;
  maxDailyBudgetDecreasePct: number;
};

const MODE_LABEL: Record<string, string> = {
  SUGGESTIONS: "Suggestions only",
  APPROVAL: "Approval required",
  AUTOMATIC: "Automatic optimization",
};

export function GoalsForm({
  accountId,
  accountName,
  currency,
  mode,
  defaults,
}: {
  accountId: string;
  accountName: string;
  currency: string;
  mode: "SUGGESTIONS" | "APPROVAL" | "AUTOMATIC";
  defaults: Defaults;
}) {
  const [state, formAction] = useActionState(saveOnboardingGoalsAction, idleState);
  const symbol = currencySymbol(currency);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="mode" value={mode} />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3.5 py-2.5">
        <p className="text-[13px]">
          <span className="text-muted-foreground">{accountName} · </span>
          <span className="font-medium">{MODE_LABEL[mode]}</span>
        </p>
        <Link
          href="/onboarding/mode"
          className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Change mode
        </Link>
      </div>

      <FormMessage state={state} />

      <fieldset className="space-y-4">
        <legend className="text-[13px] font-semibold">Targets</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="targetRoas"
            label="Target ROAS"
            type="number"
            step="0.1"
            min="0"
            suffix="x"
            placeholder="4.0"
            defaultValue={defaults.targetRoas ?? ""}
            error={errors.targetRoas}
            hint="Revenue per unit of spend you need to break even or better."
          />
          <Field
            name="targetCpa"
            label="Target CPA"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            placeholder="35.00"
            defaultValue={defaults.targetCpa ?? ""}
            error={errors.targetCpa}
            hint="Most you are willing to pay for one conversion."
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-border pt-5">
        <legend className="text-[13px] font-semibold">Profit model</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="grossMarginPct"
            label="Gross margin"
            type="number"
            step="1"
            min="0"
            max="100"
            suffix="%"
            placeholder="55"
            defaultValue={defaults.grossMarginPct ?? ""}
            error={errors.grossMarginPct}
            hint="What is left of revenue after cost of goods. Lets us rank on profit, not ROAS."
          />
          <Field
            name="minProfitPerConversion"
            label="Minimum profit per conversion"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            placeholder="15.00"
            defaultValue={defaults.minProfitPerConversion ?? ""}
            error={errors.minProfitPerConversion}
            hint="Optional. Below this, a conversion is not worth buying."
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-border pt-5">
        <legend className="text-[13px] font-semibold">Safety limits</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="maxDailyBudget"
            label="Max daily budget"
            type="number"
            step="1"
            min="0"
            prefix={symbol}
            placeholder="250"
            defaultValue={defaults.maxDailyBudget ?? ""}
            error={errors.maxDailyBudget}
            hint="Account-wide ceiling the optimizer may never exceed."
          />
          <Field
            name="maxDailyBudgetIncreasePct"
            label="Max increase per change"
            type="number"
            step="1"
            min="0"
            max="100"
            suffix="%"
            required
            defaultValue={defaults.maxDailyBudgetIncreasePct}
            error={errors.maxDailyBudgetIncreasePct}
            hint="Applies per campaign, per day."
          />
          <Field
            name="maxDailyBudgetDecreasePct"
            label="Max decrease per change"
            type="number"
            step="1"
            min="0"
            max="50"
            suffix="%"
            required
            defaultValue={defaults.maxDailyBudgetDecreasePct}
            error={errors.maxDailyBudgetDecreasePct}
            hint="Keeps a bad day from cutting a campaign to nothing."
          />
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button variant="ghost" asChild>
          <Link href="/onboarding/mode">Back</Link>
        </Button>
        <SubmitButton>Finish setup</SubmitButton>
      </div>
    </form>
  );
}
