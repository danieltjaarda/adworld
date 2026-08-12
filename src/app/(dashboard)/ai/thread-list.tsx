"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { deleteThreadAction } from "@/app/(dashboard)/ai/actions";
import { cn } from "@/lib/utils";

export function ThreadList({
  threads,
  activeId,
}: {
  threads: { id: string; title: string; updatedAt: string }[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (threads.length === 0) {
    return (
      <p className="px-4 py-4 text-[12px] leading-5 text-muted-foreground">
        Your conversations appear here. They are private to you, not shared with your workspace.
      </p>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto p-2">
      {threads.map((thread) => (
        <li key={thread.id} className="group relative">
          <Link
            href={`/ai?thread=${thread.id}`}
            className={cn(
              "block rounded-lg px-2.5 py-2 pr-8 transition-colors",
              thread.id === activeId ? "bg-secondary" : "hover:bg-secondary/60",
            )}
          >
            <span className="block truncate text-[13px] font-medium">{thread.title}</span>
            <span className="block text-[11px] text-muted-foreground">{thread.updatedAt}</span>
          </Link>

          <button
            type="button"
            aria-label={`Delete ${thread.title}`}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteThreadAction(thread.id);
                if (thread.id === activeId) router.push("/ai");
                else router.refresh();
              })
            }
            className="absolute top-2 right-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
