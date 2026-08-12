import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Lock, RefreshCw, ShieldCheck } from "lucide-react";

import { DemoAccountButton } from "@/app/onboarding/connect/demo-button";
import { StepIndicator } from "@/components/onboarding/steps";
import { Button } from "@/components/ui/button";
import { getAuthContext } from "@/lib/auth/context";
import { features } from "@/lib/env";

export const metadata: Metadata = { title: "Connect Google Ads" };

export default async function OnboardingConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const firstName = context.user.name?.split(" ")[0];

  return (
    <div className="space-y-6">
      <StepIndicator current="connect" />

      <div className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."} Let&rsquo;s connect your Google Ads
          account.
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
          We pull your campaigns, keywords, search terms and 90 days of history so the optimizer can
          work from your real numbers. Nothing in your account changes until you say so.
        </p>

        {params.error ? (
          <div className="mt-5 flex gap-2.5 rounded-lg border border-negative/20 bg-negative-soft px-4 py-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" aria-hidden />
            <p className="text-[13px] leading-5 text-negative">
              {decodeURIComponent(params.error)}
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button asChild size="lg" disabled={!features.googleAds}>
            <Link href="/api/google-ads/connect?next=/onboarding/select" prefetch={false}>
              Connect Google Ads
            </Link>
          </Button>
          <DemoAccountButton />
        </div>

        {!features.googleAds ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Live Google Ads credentials are not configured on this deployment. The demo account is
            fully functional and clearly labelled.
          </p>
        ) : null}

        <ul className="mt-7 space-y-3 border-t border-border pt-6">
          <Guarantee icon={ShieldCheck} title="Read first, write only on your terms">
            Every proposed change lists its reason, the data behind it, and its risk. In Suggestions
            mode we never touch your account at all.
          </Guarantee>
          <Guarantee icon={Lock} title="Your tokens stay server-side">
            Google refresh tokens are encrypted at rest and never sent to the browser. You can
            revoke access from here or from your Google account at any time.
          </Guarantee>
          <Guarantee icon={RefreshCw} title="Nothing is destructive">
            We never delete campaigns, ad groups or conversion actions, and every applied change is
            logged with a one-click undo where Google allows it.
          </Guarantee>
        </ul>
      </div>
    </div>
  );
}

function Guarantee({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
