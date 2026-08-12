"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plug, Sparkles, Unplug } from "lucide-react";
import { toast } from "sonner";

import {
  createDemoAccountAction,
  disconnectGoogleConnectionAction,
  discoverAccountsAction,
  linkAccountAction,
  type DiscoveredAccount,
} from "@/app/(dashboard)/accounts/actions";
import { SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Surface, SurfaceHeader } from "@/components/dashboard/surface";
import { Button } from "@/components/ui/button";
import { formatCustomerId } from "@/lib/analytics/format";
import { toUserMessage } from "@/lib/errors";

type Connection = {
  id: string;
  email: string;
  status: string;
  accountCount: number;
  lastRefreshedAt: string | null;
};

/**
 * Connection management: authorize Google once, then pick which customer accounts from
 * that login should be linked. Managers are listed but not selectable.
 */
export function ConnectPanel({
  connections,
  googleConfigured,
  preselectedConnectionId,
  initialDiscovered,
  hasDemoAccount,
}: {
  connections: Connection[];
  googleConfigured: boolean;
  preselectedConnectionId: string | null;
  /** Prefetched on the server for the connection we just came back from. */
  initialDiscovered: DiscoveredAccount[] | null;
  hasDemoAccount: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeConnection, setActiveConnection] = useState<string | null>(preselectedConnectionId);
  const [discovered, setDiscovered] = useState<DiscoveredAccount[] | null>(initialDiscovered);
  const [loading, setLoading] = useState(false);

  function toggleConnection(connectionId: string) {
    if (activeConnection === connectionId) {
      setActiveConnection(null);
      return;
    }

    setActiveConnection(connectionId);
    setDiscovered(null);
    setLoading(true);

    discoverAccountsAction(connectionId)
      .then(setDiscovered)
      .catch((error: unknown) => {
        toast.error("Could not list accounts", { description: toUserMessage(error) });
      })
      .finally(() => setLoading(false));
  }

  function link(customerId: string) {
    if (!activeConnection) return;
    startTransition(async () => {
      const result = await linkAccountAction({ connectionId: activeConnection, customerId });
      if (result.status === "success") {
        toast.success("Account connected", { description: result.message });
        router.push("/dashboard");
      } else {
        toast.error("Could not connect", { description: result.message });
      }
    });
  }

  function createDemo() {
    startTransition(async () => {
      const result = await createDemoAccountAction();
      if (result.status === "success") {
        toast.success("Demo account ready");
        router.push("/dashboard");
      } else {
        toast.error("Could not create demo account", { description: result.message });
      }
    });
  }

  function revoke(connectionId: string) {
    startTransition(async () => {
      const result = await disconnectGoogleConnectionAction(connectionId);
      if (result.status === "success") {
        toast.success("Google access revoked");
        setActiveConnection(null);
        router.refresh();
      } else {
        toast.error("Could not revoke access", { description: result.message });
      }
    });
  }

  return (
    <div className="space-y-5">
      <Surface padded={false}>
        <SurfaceHeader>
          <SectionHeader
            title="Google connections"
            description="One Google login can give access to several Google Ads accounts."
          />
          <Button asChild size="sm" disabled={!googleConfigured}>
            <Link href="/api/google-ads/connect?next=/accounts" prefetch={false}>
              <Plug className="size-3.5" />
              Connect Google Ads
            </Link>
          </Button>
        </SurfaceHeader>

        {!googleConfigured ? (
          <p className="px-5 py-4 text-[13px] leading-5 text-muted-foreground">
            Google Ads credentials are not configured on this deployment, so live connections are
            unavailable. Everything else — analysis, recommendations, approvals, audit trail — works
            against the demo account below.
          </p>
        ) : connections.length === 0 ? (
          <p className="px-5 py-4 text-[13px] leading-5 text-muted-foreground">
            No Google account is connected yet. Authorizing takes one click and can be revoked at
            any time from here or from your Google account settings.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {connections.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-medium">{connection.email}</p>
                    <StatusBadge
                      tone={
                        connection.status === "ACTIVE"
                          ? "positive"
                          : connection.status === "EXPIRED"
                            ? "warning"
                            : "negative"
                      }
                    >
                      {connection.status.toLowerCase()}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {connection.accountCount} linked{" "}
                    {connection.accountCount === 1 ? "account" : "accounts"}
                    {connection.lastRefreshedAt ? ` · refreshed ${connection.lastRefreshedAt}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleConnection(connection.id)}
                  >
                    {activeConnection === connection.id ? "Hide accounts" : "Choose accounts"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revoke(connection.id)}
                    disabled={pending}
                  >
                    <Unplug className="size-3.5" />
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {activeConnection ? (
          <div className="border-t border-border px-5 py-4">
            {loading ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Asking Google which accounts you can manage…
              </p>
            ) : discovered && discovered.length > 0 ? (
              <ul className="space-y-1.5">
                {discovered.map((account) => (
                  <li
                    key={account.customerId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">
                          {account.descriptiveName}
                        </p>
                        {account.isManager ? (
                          <StatusBadge tone="neutral">Manager</StatusBadge>
                        ) : null}
                        {account.isTestAccount ? (
                          <StatusBadge tone="warning">Test</StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {formatCustomerId(account.customerId)} · {account.currencyCode} ·{" "}
                        {account.timeZone}
                      </p>
                    </div>

                    {account.alreadyLinked ? (
                      <StatusBadge tone="positive">Connected</StatusBadge>
                    ) : (
                      <Button
                        size="sm"
                        variant={account.isManager ? "ghost" : "default"}
                        disabled={pending || account.isManager}
                        onClick={() => link(account.customerId)}
                      >
                        {account.isManager ? "Not selectable" : "Connect"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                This Google login does not have access to any Google Ads accounts.
              </p>
            )}
          </div>
        ) : null}
      </Surface>

      {!hasDemoAccount ? (
        <Surface>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden />
                <h2 className="text-[14px] font-semibold">Explore with a demo account</h2>
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                A generated account with 90 days of realistic history, including a budget-limited
                winner, a keyword quietly burning money and a conversion tracking scare. Clearly
                labelled everywhere, and never mixed with real data.
              </p>
            </div>
            <Button onClick={createDemo} disabled={pending} variant="outline">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create demo account
            </Button>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}
