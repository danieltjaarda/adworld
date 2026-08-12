"use client";

import { useActionState } from "react";

import { forgotPasswordAction } from "@/app/(auth)/actions";
import { FieldError, FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        <FieldError error={state.fieldErrors?.email} />
      </div>

      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </form>
  );
}
