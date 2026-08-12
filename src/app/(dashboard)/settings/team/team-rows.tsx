"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/app/(dashboard)/settings/team/actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Result = { status: string; message: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<Result>) {
    startTransition(async () => {
      const result = await work();
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Could not do that", { description: result.message });
      }
    });
  }

  return { run, pending };
}

export function MemberRow({
  member,
  canManage,
  viewerIsOwner,
}: {
  member: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    roleLabel: string;
    isYou: boolean;
    joined: string;
    lastActive: string;
  };
  canManage: boolean;
  viewerIsOwner: boolean;
}) {
  const { run, pending } = useRun();

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-medium">{member.name ?? member.email}</p>
          {member.isYou ? <StatusBadge tone="neutral">You</StatusBadge> : null}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {member.email} · {member.lastActive}
        </p>
      </div>

      <StatusBadge tone={member.role === "OWNER" ? "info" : "neutral"}>
        {member.roleLabel}
      </StatusBadge>

      {canManage && !member.isYou ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Manage ${member.email}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Change role</DropdownMenuLabel>
            {(["ADMIN", "MEMBER", "VIEWER"] as const).map((role) => (
              <DropdownMenuItem
                key={role}
                disabled={pending || member.role === role}
                onSelect={() => run(() => changeMemberRoleAction({ memberId: member.id, role }))}
              >
                {role.charAt(0) + role.slice(1).toLowerCase()}
              </DropdownMenuItem>
            ))}
            {viewerIsOwner ? (
              <DropdownMenuItem
                disabled={pending || member.role === "OWNER"}
                onSelect={() =>
                  run(() => changeMemberRoleAction({ memberId: member.id, role: "OWNER" }))
                }
              >
                Make owner
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onSelect={() => run(() => removeMemberAction(member.id))}
            >
              Remove from workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

export function InvitationRow({
  invitation,
  canManage,
}: {
  invitation: {
    id: string;
    email: string;
    roleLabel: string;
    sent: string;
    expires: string;
  };
  canManage: boolean;
}) {
  const { run, pending } = useRun();

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{invitation.email}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {invitation.roleLabel} · sent {invitation.sent} · expires {invitation.expires}
        </p>
      </div>

      {canManage ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => revokeInvitationAction(invitation.id))}
        >
          Revoke
        </Button>
      ) : null}
    </li>
  );
}
