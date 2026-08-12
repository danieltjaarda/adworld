"use client";

import { useActionState } from "react";

import { inviteMemberAction } from "@/app/(dashboard)/settings/team/actions";
import { Field } from "@/components/forms/field";
import { FormMessage, SubmitButton, idleState } from "@/components/forms/form-state";
import { Label } from "@/components/ui/label";

export function InviteForm() {
  const [state, formAction] = useActionState(inviteMemberAction, idleState);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          name="email"
          label="Email address"
          type="email"
          placeholder="colleague@company.com"
          required
          className="min-w-[240px] flex-1"
          error={state.fieldErrors?.email}
        />

        <div className="space-y-1.5">
          <Label htmlFor="role" className="text-[13px] font-medium">
            Role
          </Label>
          <select
            id="role"
            name="role"
            defaultValue="MEMBER"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </div>

        <SubmitButton>Send invitation</SubmitButton>
      </div>
    </form>
  );
}
