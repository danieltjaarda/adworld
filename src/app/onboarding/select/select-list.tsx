"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  discoverAccountsAction,
  linkAccountAction,
  type DiscoveredAccount,
} from "@/app/(dashboard)/accounts/actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { formatCustomerId } from "@/lib/analytics/format";
import { toUserMessage } from "@/lib/errors";

type Connection = { id: string; email: string };

export function SelectAccountList({
  connections,
  initialAccounts,
  initialError,
}: {
  connections: Connection[];
  initialAccounts: DiscoveredAccount[] | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [accounts, setAccounts] = useState<DiscoveredAccount[] | null>(initialAccounts);
  const [error, setError] = useState<string | null>(initialError);
  const [linking, setLinking] = useState<string | null>(null);

  function selectConnection(nextConnectionId: string) {
    if (nextConnectionId === connectionId) return;

    setConnectionId(nextConnectionId);
    setAccounts(null);
    setError(null);

    discoverAccountsAction(nextConnectionId)
      .then(setAccounts)
      .catch((cause: unknown) => setError(toUserMessage(cause)));
  }

  function link(customerId: string) {
    setLinking(customerId);
    startTransition(async () => {
      const result = await linkAccountAction({ connectionId, customerId });
      setLinking(null);
      if (result.status === "success") {
        router.push("/onboarding/mode");
      } else {
        toast.error("Could not connect that account", { description: result.message });
      }
    });
  }

  const selectable = accounts?.filter((account) => !account.isManager) ?? [];
  const managers = accounts?.filter((account) => account.isManager) ?? [];

  return (
    <div>
      {connections.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-6 py-3 sm:px-8">
          {connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              onClick={() => selectConnection(connection.id)}
              className={
                connection.id === connectionId
                  ? "rounded-md bg-secondary px-2.5 py-1 text-[12px] font-medium text-foreground"
                  : "rounded-md px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-secondary/60"
              }
            >
              {connection.email}
            </button>
          ))}
        </div>
      ) : null}

      {accounts === null && !error ? (
        <p className="flex items-center gap-2 px-6 py-8 text-[13px] text-muted-foreground sm:px-8">
          <Loader2 className="size-4 animate-spin" />
          Loading the accounts you can manage…
        </p>
      ) : error ? (
        <p className="px-6 py-8 text-[13px] text-negative sm:px-8">{error}</p>
      ) : selectable.length === 0 ? (
        <p className="px-6 py-8 text-[13px] leading-5 text-muted-foreground sm:px-8">
          This Google login can only reach manager accounts, which cannot be optimized directly.
          Connect a login that has access to a client account.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {selectable.map((account) => (
            <li
              key={account.customerId}
              className="flex flex-wrap items-center gap-3 px-6 py-4 sm:px-8"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-medium">{account.descriptiveName}</p>
                  {account.isTestAccount ? <StatusBadge tone="warning">Test</StatusBadge> : null}
                  {account.alreadyLinked ? (
                    <StatusBadge tone="positive">Connected</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {formatCustomerId(account.customerId)} · {account.currencyCode} ·{" "}
                  {account.timeZone}
                </p>
              </div>

              <Button
                size="sm"
                variant={account.alreadyLinked ? "outline" : "default"}
                disabled={pending}
                onClick={() => link(account.customerId)}
              >
                {linking === account.customerId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {account.alreadyLinked ? "Continue" : "Select"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {managers.length > 0 ? (
        <p className="border-t border-border px-6 py-3 text-[12px] text-muted-foreground sm:px-8">
          {managers.length} manager {managers.length === 1 ? "account" : "accounts"} hidden — Google
          does not allow optimizing them directly.
        </p>
      ) : null}
    </div>
  );
}
