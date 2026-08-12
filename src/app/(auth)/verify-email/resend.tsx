"use client";

import { useActionState } from "react";

import { resendVerificationAction } from "@/app/(auth)/actions";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";

export function ResendVerification() {
  const [state, formAction] = useActionState(async () => resendVerificationAction(), idleState);

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="outline" size="sm">
        Send a new link
      </SubmitButton>
    </form>
  );
}
