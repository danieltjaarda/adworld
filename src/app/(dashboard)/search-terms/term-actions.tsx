"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Ban, Check, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  addKeywordAction,
  addNegativeKeywordAction,
  ignoreSearchTermAction,
} from "@/app/(dashboard)/search-terms/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Row-level optimizer controls. Suggestions mode disables them entirely rather than
 * failing later, so the mode promise is visible in the UI.
 */
export function SearchTermActions({
  termId,
  canAct,
  hasAdGroup,
  blockedReason,
}: {
  termId: string;
  canAct: boolean;
  hasAdGroup: boolean;
  blockedReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const result = await work();
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Could not apply that", { description: result.message });
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={!canAct || pending}
        title={canAct ? "Add as a negative keyword" : blockedReason}
        onClick={() =>
          run(() => addNegativeKeywordAction({ termId, matchType: "PHRASE", level: "AD_GROUP" }))
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
        <span className="hidden lg:inline">Negative</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Search term</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!canAct || !hasAdGroup}
            onSelect={() =>
              run(() => addKeywordAction({ termId, matchType: "EXACT", level: "AD_GROUP" }))
            }
          >
            <Plus className="size-3.5" />
            Add as exact keyword
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canAct}
            onSelect={() =>
              run(() =>
                addNegativeKeywordAction({ termId, matchType: "EXACT", level: "CAMPAIGN" }),
              )
            }
          >
            <Ban className="size-3.5" />
            Negative for whole campaign
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => run(() => ignoreSearchTermAction(termId))}>
            <Check className="size-3.5" />
            Mark as reviewed
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
