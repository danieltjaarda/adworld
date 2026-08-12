"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { deleteOrganizationAction } from "@/app/(dashboard)/settings/actions";
import { SectionHeader } from "@/components/dashboard/page-header";
import { Surface } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DangerZone({
  organizationName,
  canDelete,
}: {
  organizationName: string;
  canDelete: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Surface className="border-negative/25">
      <SectionHeader
        title="Delete this workspace"
        description="Removes the workspace, its connected accounts and every stored metric, recommendation and log. Google Ads itself is untouched. This cannot be undone."
      />

      {canDelete ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-full max-w-xs space-y-1.5">
            <label htmlFor="confirm-delete" className="text-[13px] font-medium">
              Type <span className="font-semibold">{organizationName}</span> to confirm
            </label>
            <Input
              id="confirm-delete"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>
          <Button
            variant="destructive"
            disabled={pending || confirmation !== organizationName}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteOrganizationAction(confirmation);
                if (result.status === "error") {
                  toast.error("Not deleted", { description: result.message });
                }
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete workspace
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          This is your only workspace, so it cannot be deleted. Create another one first if you
          want to start over.
        </p>
      )}
    </Surface>
  );
}
