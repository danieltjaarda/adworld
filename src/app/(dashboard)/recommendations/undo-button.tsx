"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { undoActionAction } from "@/app/(dashboard)/recommendations/actions";
import { Button } from "@/components/ui/button";

export function UndoButton({ actionId, disabled }: { actionId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const result = await undoActionAction(actionId);
          if (result.status === "success") {
            toast.success("Undone", { description: result.message });
            router.refresh();
          } else {
            toast.error("Could not undo", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
      Undo
    </Button>
  );
}
