"use client";

import { useState } from "react";
import { useActionState } from "react";

import { updateOptimizationAction } from "@/app/(dashboard)/settings/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { ToggleRow } from "@/components/forms/toggle-row";
import { SectionHeader } from "@/components/dashboard/page-header";
import { ModePicker, type OptimizationModeValue } from "@/components/settings/mode-picker";
import { Surface } from "@/components/dashboard/surface";
import { currencySymbol } from "@/lib/analytics/format";
import type { AccountSettings } from "@/lib/analytics/queries";

export function OptimizationForm({
  accountId,
  currency,
  settings,
  canManage,
  automaticAllowed,
  planName,
}: {
  accountId: string;
  currency: string;
  settings: AccountSettings;
  canManage: boolean;
  automaticAllowed: boolean;
  planName: string;
}) {
  const [state, formAction] = useActionState(updateOptimizationAction, idleState);
  const [mode, setMode] = useState<OptimizationModeValue>(settings.mode);
  const symbol = currencySymbol(currency);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="mode" value={mode} />

      <Surface>
        <SectionHeader title="Optimization mode" />
        <div className="mt-4">
          <ModePicker
            value={mode}
            onChange={setMode}
            automaticLocked={!automaticAllowed}
            automaticLockedReason={`Automatic execution is not included in the ${planName} plan.`}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="Targets"
          description="What the optimizer treats as success. Leave blank to use the account's own averages as the reference."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            name="targetRoas"
            label="Target ROAS"
            type="number"
            step="0.1"
            min="0"
            suffix="x"
            defaultValue={settings.targetRoas ?? ""}
            disabled={!canManage}
            error={errors.targetRoas}
          />
          <Field
            name="targetCpa"
            label="Target CPA"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            defaultValue={settings.targetCpa ?? ""}
            disabled={!canManage}
            error={errors.targetCpa}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="Profit model"
          description="With a margin configured, the optimizer ranks on profit instead of revenue — a 10x ROAS on a 15% margin product loses money at scale."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            name="grossMarginPct"
            label="Gross margin"
            type="number"
            step="1"
            min="0"
            max="100"
            suffix="%"
            defaultValue={settings.grossMarginPct ?? ""}
            disabled={!canManage}
            error={errors.grossMarginPct}
          />
          <Field
            name="fixedCostPerOrder"
            label="Fixed cost per conversion"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            defaultValue={settings.fixedCostPerOrder ?? ""}
            disabled={!canManage}
            hint="Picking, shipping, payment fees."
            error={errors.fixedCostPerOrder}
          />
          <Field
            name="leadValue"
            label="Value per lead"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            defaultValue={settings.leadValue ?? ""}
            disabled={!canManage}
            hint="Used when conversions carry no revenue of their own."
            error={errors.leadValue}
          />
          <Field
            name="minProfitPerConversion"
            label="Minimum profit per conversion"
            type="number"
            step="0.01"
            min="0"
            prefix={symbol}
            defaultValue={settings.minProfitPerConversion ?? ""}
            disabled={!canManage}
            error={errors.minProfitPerConversion}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="Safety limits"
          description="Hard ceilings the optimizer can never exceed, whatever it concludes. Lowering these makes the system more conservative; the system's own maximums still apply on top."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            name="maxDailyBudget"
            label="Max daily budget"
            type="number"
            step="1"
            min="0"
            prefix={symbol}
            defaultValue={settings.maxDailyBudget ?? ""}
            disabled={!canManage}
            error={errors.maxDailyBudget}
          />
          <Field
            name="maxDailyBudgetIncreasePct"
            label="Max budget increase"
            type="number"
            step="1"
            min="0"
            max="100"
            suffix="%"
            defaultValue={settings.maxDailyBudgetIncreasePct}
            disabled={!canManage}
            error={errors.maxDailyBudgetIncreasePct}
          />
          <Field
            name="maxDailyBudgetDecreasePct"
            label="Max budget decrease"
            type="number"
            step="1"
            min="0"
            max="50"
            suffix="%"
            defaultValue={settings.maxDailyBudgetDecreasePct}
            disabled={!canManage}
            error={errors.maxDailyBudgetDecreasePct}
          />
          <Field
            name="maxBidChangePct"
            label="Max bid change"
            type="number"
            step="1"
            min="0"
            max="50"
            suffix="%"
            defaultValue={settings.maxBidChangePct}
            disabled={!canManage}
            error={errors.maxBidChangePct}
          />
          <Field
            name="maxActionsPerRun"
            label="Max changes per run"
            type="number"
            step="1"
            min="1"
            max="100"
            defaultValue={settings.maxActionsPerRun}
            disabled={!canManage}
            error={errors.maxActionsPerRun}
          />
          <Field
            name="minConfidence"
            label="Minimum confidence"
            type="number"
            step="0.05"
            min="0.3"
            max="0.99"
            defaultValue={settings.minConfidence}
            disabled={!canManage}
            hint="Below this, changes wait for a person even in automatic mode."
            error={errors.minConfidence}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="Data thresholds"
          description="How much evidence the optimizer needs before it will judge a keyword, term or ad. Raising these means fewer, better-supported changes."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            name="minClicksForDecision"
            label="Minimum clicks"
            type="number"
            step="1"
            min="1"
            defaultValue={settings.minClicksForDecision}
            disabled={!canManage}
            error={errors.minClicksForDecision}
          />
          <Field
            name="minImpressionsForDecision"
            label="Minimum impressions"
            type="number"
            step="10"
            min="1"
            defaultValue={settings.minImpressionsForDecision}
            disabled={!canManage}
            error={errors.minImpressionsForDecision}
          />
          <Field
            name="minSpendForDecision"
            label="Minimum spend"
            type="number"
            step="1"
            min="0"
            prefix={symbol}
            defaultValue={settings.minSpendForDecision}
            disabled={!canManage}
            error={errors.minSpendForDecision}
          />
          <Field
            name="minConversionsForScaling"
            label="Minimum conversions to scale"
            type="number"
            step="0.5"
            min="0"
            defaultValue={settings.minConversionsForScaling}
            disabled={!canManage}
            hint="Required before a budget increase is proposed."
            error={errors.minConversionsForScaling}
          />
          <Field
            name="lookbackDays"
            label="Lookback window"
            type="number"
            step="1"
            min="7"
            max="180"
            suffix="days"
            defaultValue={settings.lookbackDays}
            disabled={!canManage}
            error={errors.lookbackDays}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="What may run automatically"
          description={
            mode === "AUTOMATIC"
              ? "These change types are applied without waiting for approval. Everything else still lands in the action center."
              : "These only take effect in Automatic mode. In Approval mode every change waits for you."
          }
        />
        <div className="mt-2">
          <ToggleRow
            name="autoNegativeKeywords"
            label="Add negative keywords"
            description="Blocks queries that spent without converting. The lowest-risk automation and usually the first one to enable."
            defaultChecked={settings.autoNegativeKeywords}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
          <ToggleRow
            name="autoBudgetChanges"
            label="Change campaign budgets"
            description="Only within the percentage limits above, and never past the account maximum."
            defaultChecked={settings.autoBudgetChanges}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
          <ToggleRow
            name="autoBidChanges"
            label="Change keyword bids"
            defaultChecked={settings.autoBidChanges}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
          <ToggleRow
            name="autoAddKeywords"
            label="Add keywords"
            description="Promotes converting search terms into their own keyword."
            defaultChecked={settings.autoAddKeywords}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
          <ToggleRow
            name="autoPauseKeywords"
            label="Pause keywords"
            description="Only keywords that clear the data thresholds and have spent without converting."
            defaultChecked={settings.autoPauseKeywords}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
          <ToggleRow
            name="autoPauseAds"
            label="Pause underperforming ads"
            description="Never the last remaining ad in an ad group."
            defaultChecked={settings.autoPauseAds}
            disabled={!canManage || mode !== "AUTOMATIC"}
          />
        </div>

        <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
          Campaigns, ad groups, keywords and conversion actions are never deleted, conversion
          tracking and billing settings are never touched, and pausing a campaign always requires a
          person — regardless of these switches.
        </p>
      </Surface>

      <div className="flex flex-wrap items-center gap-3">
        {canManage ? <SubmitButton>Save settings</SubmitButton> : null}
        <FormMessage state={state} className="flex-1" />
      </div>
    </form>
  );
}
