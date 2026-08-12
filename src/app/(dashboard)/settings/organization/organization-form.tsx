"use client";

import { useActionState } from "react";

import { updateOrganizationAction } from "@/app/(dashboard)/settings/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { TimezoneSelect } from "@/components/forms/timezone-select";

export function OrganizationForm({
  name,
  currencyCode,
  timezone,
  slug,
  canManage,
}: {
  name: string;
  currencyCode: string;
  timezone: string;
  slug: string;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(updateOrganizationAction, idleState);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="name"
          label="Workspace name"
          defaultValue={name}
          required
          disabled={!canManage}
          error={state.fieldErrors?.name}
          hint={`Identifier: ${slug}`}
        />
        <Field
          name="currencyCode"
          label="Reporting currency"
          defaultValue={currencyCode}
          maxLength={3}
          required
          disabled={!canManage}
          error={state.fieldErrors?.currencyCode}
          hint="Each Google Ads account keeps its own currency; this is the workspace default."
        />
        <TimezoneSelect name="timezone" label="Time zone" defaultValue={timezone} />
      </div>

      {canManage ? (
        <SubmitButton>Save changes</SubmitButton>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Only owners and admins can change workspace settings.
        </p>
      )}
    </form>
  );
}
