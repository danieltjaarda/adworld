"use client";

import { useActionState } from "react";

import { signupAction } from "@/app/(auth)/actions";
import { FieldError, FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <div className="space-y-1.5">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          placeholder="Daniel Tjaarda"
          required
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
        <FieldError error={state.fieldErrors?.name} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
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

      <div className="space-y-1.5">
        <Label htmlFor="organizationName">Workspace name</Label>
        <Input
          id="organizationName"
          name="organizationName"
          placeholder="Your company or agency"
          aria-invalid={Boolean(state.fieldErrors?.organizationName)}
        />
        <p className="text-[12px] text-muted-foreground">
          Optional. You can rename it later, and add teammates to it.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
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

      <SubmitButton className="w-full">Create account</SubmitButton>
    </form>
  );
}
