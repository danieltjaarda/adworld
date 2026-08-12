"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { acceptInvitationAction } from "@/app/invite/actions";
import { Button } from "@/components/ui/button";

export function AcceptInvitation({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await acceptInvitationAction(token);
          if (result.status === "error") {
            toast.error("Could not join", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Join {organizationName}
    </Button>
  );
}
