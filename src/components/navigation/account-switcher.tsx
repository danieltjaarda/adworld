"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Building2, Plus } from "lucide-react";

import { switchAccountAction, switchOrganizationAction } from "@/app/(dashboard)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, initialsFrom } from "@/lib/utils";

export type SwitcherAccount = {
  id: string;
  name: string;
  customerId: string;
  isDemo: boolean;
};

export type SwitcherWorkspace = {
  id: string;
  name: string;
};

/**
 * The account selector, permanently in the header. It doubles as the workspace switcher
 * for agencies, because those two choices answer the same question: whose data am I
 * looking at?
 */
export function AccountSwitcher({
  accounts,
  activeAccountId,
  workspaces,
  activeWorkspaceId,
}: {
  accounts: SwitcherAccount[];
  activeAccountId: string | null;
  workspaces: SwitcherWorkspace[];
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = accounts.find((account) => account.id === activeAccountId) ?? accounts[0] ?? null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  function selectAccount(accountId: string) {
    if (accountId === active?.id) return;
    startTransition(async () => {
      await switchAccountAction(accountId);
      router.refresh();
    });
  }

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    startTransition(async () => {
      await switchOrganizationAction(workspaceId);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 max-w-[280px] items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          pending && "opacity-60",
        )}
        aria-label="Switch Google Ads account"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold text-secondary-foreground">
          {active ? initialsFrom(active.name) : "—"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-foreground">
            {active?.name ?? "No account connected"}
          </span>
          {active ? (
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {active.isDemo ? "Demo data" : formatCustomerId(active.customerId)}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[300px]">
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          Google Ads accounts
        </DropdownMenuLabel>

        {accounts.length === 0 ? (
          <p className="px-2 py-1.5 text-[13px] text-muted-foreground">Nothing connected yet.</p>
        ) : (
          accounts.map((account) => (
            <DropdownMenuItem
              key={account.id}
              onSelect={() => selectAccount(account.id)}
              className="gap-2"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold text-secondary-foreground">
                {initialsFrom(account.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4">{account.name}</span>
                <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                  {account.isDemo ? "Demo data" : formatCustomerId(account.customerId)}
                </span>
              </span>
              {account.id === active?.id ? (
                <Check className="size-4 text-primary" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => router.push("/accounts")} className="gap-2">
          <Plus className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-[13px]">Connect another account</span>
        </DropdownMenuItem>

        {workspaces.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => selectWorkspace(workspace.id)}
                className="gap-2"
              >
                <Building2 className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-[13px]">{workspace.name}</span>
                {workspace.id === activeWorkspace?.id ? (
                  <Check className="size-4 text-primary" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatCustomerId(customerId: string): string {
  const digits = customerId.replace(/\D/g, "");
  if (digits.length !== 10) return customerId;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
