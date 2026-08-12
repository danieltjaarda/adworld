"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { disconnectAccountAction } from "@/app/(dashboard)/accounts/actions";
import { SyncButton } from "@/app/(dashboard)/accounts/sync-button";
import { switchAccountAction } from "@/app/(dashboard)/actions";
import { StatusBadge, type Tone } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCustomerId, formatRelativeTime } from "@/lib/analytics/format";

type AccountRow = {
  id: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isDemo: boolean;
  isActive: boolean;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: Date | null;
  connection: { id: string; email: string; status: string } | null;
  _count: { campaigns: number };
};

const SYNC_TONE: Record<string, Tone> = {
  SYNCED: "positive",
  SYNCING: "info",
  ERROR: "negative",
  NEVER_SYNCED: "neutral",
};

export function AccountList({
  accounts,
  canManage,
}: {
  accounts: AccountRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingRemoval, setPendingRemoval] = useState<AccountRow | null>(null);
  const [pending, startTransition] = useTransition();

  function open(accountId: string) {
    startTransition(async () => {
      await switchAccountAction(accountId);
      router.push("/dashboard");
    });
  }

  function confirmRemoval() {
    if (!pendingRemoval) return;
    const account = pendingRemoval;
    startTransition(async () => {
      const result = await disconnectAccountAction(account.id);
      setPendingRemoval(null);
      if (result.status === "success") {
        toast.success("Account disconnected", { description: result.message });
        router.refresh();
      } else {
        toast.error("Could not disconnect", { description: result.message });
      }
    });
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => open(account.id)}
                  className="truncate text-[14px] font-medium hover:text-primary"
                >
                  {account.descriptiveName}
                </button>
                {account.isDemo ? <StatusBadge tone="info">Demo</StatusBadge> : null}
                <StatusBadge tone={SYNC_TONE[account.syncStatus] ?? "neutral"}>
                  {account.syncStatus === "NEVER_SYNCED"
                    ? "Not synced"
                    : account.syncStatus.charAt(0) + account.syncStatus.slice(1).toLowerCase()}
                </StatusBadge>
              </div>

              <p className="mt-1 truncate text-[12px] text-muted-foreground">
                {account.isDemo ? "Generated data" : formatCustomerId(account.customerId)} ·{" "}
                {account.currencyCode} · {account._count.campaigns} campaigns · synced{" "}
                {formatRelativeTime(account.lastSyncedAt)}
                {account.connection ? ` · via ${account.connection.email}` : ""}
              </p>

              {account.syncError ? (
                <p className="mt-1 text-[12px] text-negative">{account.syncError}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => open(account.id)} disabled={pending}>
                Open
              </Button>
              <SyncButton accountId={account.id} />

              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Account options">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setPendingRemoval(account)}
                      variant="destructive"
                    >
                      <Trash2 className="size-4" />
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {pendingRemoval?.descriptiveName}?</DialogTitle>
            <DialogDescription>
              This deletes the campaigns, metrics, recommendations and audit history we stored for
              this account. Your Google Ads account itself is not affected, and no changes are
              reverted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemoval(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoval} disabled={pending}>
              Disconnect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
