"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/app/(dashboard)/settings/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, idleState);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormMessage state={state} />

      <Field
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.currentPassword}
      />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters, with a number or symbol."
        error={state.fieldErrors?.password}
      />
      <Field
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />

      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}
