"use client";

import { useActionState } from "react";

import { resetPasswordAction } from "@/app/(auth)/actions";
import { FieldError, FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <FormMessage state={state} />

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <FieldError error={state.fieldErrors?.password} />
        {!state.fieldErrors?.password ? (
          <p className="text-[12px] text-muted-foreground">
            At least 10 characters, with a number or symbol.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
        <FieldError error={state.fieldErrors?.confirmPassword} />
      </div>

      <SubmitButton className="w-full">Set new password</SubmitButton>
    </form>
  );
}
