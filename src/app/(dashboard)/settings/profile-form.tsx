"use client";

import { useActionState } from "react";

import { updateProfileAction } from "@/app/(dashboard)/settings/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { TimezoneSelect } from "@/components/forms/timezone-select";

export function ProfileForm({ name, timezone }: { name: string; timezone: string }) {
  const [state, formAction] = useActionState(updateProfileAction, idleState);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="name"
          label="Full name"
          defaultValue={name}
          required
          error={state.fieldErrors?.name}
        />
        <TimezoneSelect
          name="timezone"
          label="Time zone"
          defaultValue={timezone}
          hint="Used for report dates and scheduling."
        />
      </div>

      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
