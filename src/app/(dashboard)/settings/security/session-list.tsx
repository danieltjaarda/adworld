"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/app/(dashboard)/settings/actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";

type SessionView = {
  id: string;
  current: boolean;
  device: string;
  ipAddress: string | null;
  lastActive: string;
  signedIn: string;
};

export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const result = await work();
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Could not end that session", { description: result.message });
      }
    });
  }

  const others = sessions.filter((session) => !session.current).length;

  return (
    <>
      <ul className="divide-y divide-border border-t border-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium">{session.device}</p>
                {session.current ? <StatusBadge tone="positive">This device</StatusBadge> : null}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {session.ipAddress ?? "Unknown IP"} · active {session.lastActive} · signed in{" "}
                {session.signedIn}
              </p>
            </div>

            {!session.current ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => revokeSessionAction(session.id))}
              >
                Sign out
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {others > 0 ? (
        <div className="border-t border-border px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => revokeOtherSessionsAction())}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Sign out {others} other {others === 1 ? "session" : "sessions"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
