import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BillingActions } from "@/app/(dashboard)/billing/billing-actions";
import { PlanGrid } from "@/app/(dashboard)/billing/plan-grid";
import { UsageMeters } from "@/app/(dashboard)/billing/usage-meters";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { StatusBadge, type Tone } from "@/components/dashboard/status-badge";
import { Surface } from "@/components/dashboard/surface";
import { formatCurrency, formatDate } from "@/lib/analytics/format";
import { getAuthContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { getUsageSnapshot } from "@/lib/billing/limits";
import { planFor } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import { isStripeConfigured } from "@/lib/stripe/client";
import { listInvoices, refreshFromStripe } from "@/lib/stripe/checkout";
import type { SearchParams } from "@/lib/dashboard/page-context";

export const metadata: Metadata = { title: "Billing" };

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "positive",
  TRIALING: "info",
  PAST_DUE: "warning",
  UNPAID: "negative",
  CANCELED: "neutral",
  INCOMPLETE: "warning",
  PAUSED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Payment failed",
  UNPAID: "Unpaid",
  CANCELED: "Cancelled",
  INCOMPLETE: "Incomplete",
  PAUSED: "Paused",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const params = await searchParams;

  // Coming back from checkout, pull the truth from Stripe rather than waiting for the
  // webhook — otherwise the page you land on still shows the old plan.
  if (params.checkout === "success" && isStripeConfigured()) {
    await refreshFromStripe(context.organization.id);
  }

  const [usage, subscription, invoices] = await Promise.all([
    getUsageSnapshot(context.organization.id),
    prisma.subscription.findUnique({
      where: { organizationId: context.organization.id },
      select: {
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        trialEndsAt: true,
        stripeCustomerId: true,
      },
    }),
    isStripeConfigured() ? listInvoices(context.organization.id) : Promise.resolve([]),
  ]);

  const plan = planFor(usage.entitlements.plan);
  const status = subscription?.status ?? "ACTIVE";
  const canManage = can(context.role, "billing:manage");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing"
        description="Your plan, what you have used this month and your invoices."
      />

      {params.checkout === "success" ? (
        <div className="rounded-xl border border-positive/25 bg-positive-soft px-4 py-3 text-[13px] text-positive">
          Payment confirmed. Your new plan is active.
        </div>
      ) : null}

      <Surface>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{plan.name}</h2>
              <StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>
                {STATUS_LABEL[status] ?? status}
              </StatusBadge>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{plan.tagline}</p>

            <p className="mt-3 text-[13px]">
              {plan.indicativePrice === 0 ? (
                "No charge."
              ) : (
                <>
                  <span className="tabular text-[20px] font-semibold">
                    {formatCurrency(plan.indicativePrice ?? 0, "EUR", { decimals: 0 })}
                  </span>
                  <span className="text-muted-foreground"> per month</span>
                </>
              )}
            </p>

            <p className="mt-2 text-[12px] text-muted-foreground">
              {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd
                ? `Cancels on ${formatDate(subscription.currentPeriodEnd)}.`
                : subscription?.trialEndsAt && status === "TRIALING"
                  ? `Trial ends ${formatDate(subscription.trialEndsAt)}.`
                  : subscription?.currentPeriodEnd
                    ? `Renews ${formatDate(subscription.currentPeriodEnd)}.`
                    : "Free plan — no billing period."}
            </p>
          </div>

          <BillingActions
            canManage={canManage}
            hasCustomer={Boolean(subscription?.stripeCustomerId)}
            stripeConfigured={isStripeConfigured()}
          />
        </div>

        {status === "PAST_DUE" || status === "UNPAID" ? (
          <p className="mt-4 rounded-lg bg-warning-soft px-3.5 py-2.5 text-[12px] leading-5 text-warning">
            The last payment failed, so changes to Google Ads are paused. Your data and
            recommendations stay available — update your payment method to resume.
          </p>
        ) : null}
      </Surface>

      <Surface>
        <SectionHeader
          title="Usage this month"
          description="Counters reset on the first of each month."
        />
        <div className="mt-4">
          <UsageMeters usage={usage} />
        </div>
      </Surface>

      <div>
        <SectionHeader
          title="Plans"
          description="Change at any time. Upgrades apply immediately, downgrades at the end of the period."
          className="mb-3"
        />
        <PlanGrid current={usage.entitlements.plan} canManage={canManage} />
      </div>

      {invoices.length > 0 ? (
        <Surface padded={false}>
          <div className="px-5 py-4">
            <SectionHeader title="Invoices" />
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{invoice.number ?? invoice.id}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {formatDate(invoice.createdAt)}
                  </p>
                </div>
                <span className="tabular text-[13px]">
                  {formatCurrency(invoice.total / 100, invoice.currency)}
                </span>
                <StatusBadge tone={invoice.status === "paid" ? "positive" : "warning"}>
                  {invoice.status ?? "unknown"}
                </StatusBadge>
                {invoice.hostedUrl ? (
                  <a
                    href={invoice.hostedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      {!isStripeConfigured() ? (
        <p className="text-[12px] leading-5 text-muted-foreground">
          Stripe is not configured on this deployment, so every workspace runs on the Free plan
          and checkout is unavailable. Set <code className="text-foreground">STRIPE_SECRET_KEY</code>{" "}
          and the price IDs to enable self-serve billing.
        </p>
      ) : null}
    </div>
  );
}
