"use client";

import { useActionState } from "react";

import { updateNotificationsAction } from "@/app/(dashboard)/settings/actions";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { ToggleRow } from "@/components/forms/toggle-row";

export function NotificationsForm({
  accountId,
  canManage,
  settings,
}: {
  accountId: string;
  canManage: boolean;
  settings: {
    notifyOnRecommendation: boolean;
    notifyOnAnomaly: boolean;
    notifyOnAutoAction: boolean;
    weeklyReportEmail: boolean;
  };
}) {
  const [state, formAction] = useActionState(updateNotificationsAction, idleState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="accountId" value={accountId} />

      <div>
        <ToggleRow
          name="notifyOnAnomaly"
          label="Performance anomalies"
          description="Spend spikes, conversions disappearing, ROAS collapsing, a campaign that stopped serving. The alerts worth interrupting your day for."
          defaultChecked={settings.notifyOnAnomaly}
          disabled={!canManage}
        />
        <ToggleRow
          name="notifyOnRecommendation"
          label="New recommendations"
          description="A daily note when the optimizer finds changes worth reviewing."
          defaultChecked={settings.notifyOnRecommendation}
          disabled={!canManage}
        />
        <ToggleRow
          name="notifyOnAutoAction"
          label="Automatic changes"
          description="Sent whenever the optimizer applies something without asking. Recommended while you build trust in automatic mode."
          defaultChecked={settings.notifyOnAutoAction}
          disabled={!canManage}
        />
        <ToggleRow
          name="weeklyReportEmail"
          label="Weekly report"
          description="Monday morning summary of spend, revenue, ROAS and what changed."
          defaultChecked={settings.weeklyReportEmail}
          disabled={!canManage}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canManage ? <SubmitButton>Save preferences</SubmitButton> : null}
        <FormMessage state={state} className="flex-1" />
      </div>
    </form>
  );
}
