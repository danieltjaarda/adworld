import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getAuthContext } from "@/lib/auth/context";
import { PLANS, PLAN_ORDER, describeLimit } from "@/lib/billing/plans";

/**
 * Public landing page. Signed-in visitors are sent straight to their dashboard, so this
 * is only ever the first screen of the product, never a detour.
 */

const STEPS = [
  {
    title: "Connect an account",
    body: "Sign in with Google and pick the Ads accounts you want to work on. Tokens are encrypted and stay on the server.",
  },
  {
    title: "We build the picture",
    body: "Campaigns, keywords, search terms, ads and 90 days of daily metrics are synced into your workspace and kept current.",
  },
  {
    title: "The agent does the reading",
    body: "Statistics are calculated deterministically, then the model classifies intent, prioritizes and explains what it found.",
  },
  {
    title: "You decide how much rope",
    body: "Suggestions, approval, or automatic within limits you set. Every change is logged with its reasoning and can be undone.",
  },
];

const CAPABILITIES = [
  ["Search term waste", "Finds the queries spending without converting and proposes the right negative, at the right level."],
  ["Keyword decisions", "Bid, pause and match-type changes, never from a sample too small to mean anything."],
  ["Budget allocation", "Spots campaigns capped below their ROAS and moves money toward them within your daily limits."],
  ["Ad copy", "Drafts variants against your best performers. Nothing publishes without your approval."],
  ["Profit, not just ROAS", "Give it your margin and it optimizes for what you keep, not for revenue you had to buy."],
  ["Anomaly alerts", "Conversion drops, spend spikes and tracking breakage surface the day they happen, not at month end."],
];

export default async function LandingPage() {
  const context = await getAuthContext();
  if (context) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="#how-it-works" className="hidden sm:inline-flex">
                How it works
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="#pricing" className="hidden sm:inline-flex">
                Pricing
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Start free</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-center lg:py-28">
            <div>
              <p className="text-[13px] font-medium text-primary">AI optimization for Google Ads</p>
              <h1 className="mt-3 max-w-xl text-[40px] leading-[1.1] font-semibold tracking-[-0.03em] text-foreground sm:text-[52px]">
                An analyst for your ad account that never skips a day.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-7 text-muted-foreground">
                Connect your Google Ads accounts and get a daily read on what is working, what is
                wasting money, and what to change — with the evidence behind every
                recommendation and hard limits on what can be changed automatically.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" asChild>
                  <Link href="/signup">
                    Start free
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>

              <p className="mt-4 text-[13px] text-muted-foreground">
                No card required. Explore the whole product on a demo account before you connect
                anything real.
              </p>
            </div>

            <ExamplePanel />
          </div>
        </section>

        <section id="how-it-works" className="border-b border-border bg-canvas">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
              How it works
            </h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="bg-background p-6">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-secondary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
              What it looks at
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted-foreground">
              Every number comes from your account. The model is used for judgement — intent,
              priority, wording — never for arithmetic, and never to invent a metric.
            </p>

            <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map(([title, body]) => (
                <div key={title}>
                  <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-canvas">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div>
              <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
                Built to be trusted with a budget
              </h2>
              <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                An agent with write access to an ad account is only as good as the limits around
                it. These are not settings you have to remember to switch on.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {[
                "Budget and bid changes are clamped to your daily limits, and to a hard ceiling no setting can exceed.",
                "Campaigns, ad groups, conversion tracking and account settings can never be deleted or altered automatically.",
                "Decisions need a minimum of clicks, impressions and spend behind them before they are made at all.",
                "Every action stores the previous state, so it can be reversed from the audit log.",
              ].map((item) => (
                <li key={item} className="flex gap-2.5 rounded-lg border border-border bg-background p-4">
                  <Check className="mt-0.5 size-4 shrink-0 text-positive" />
                  <span className="text-[13px] leading-5 text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">Pricing</h2>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Start on Free for as long as you like. Upgrade when you want the agent to apply
              changes instead of only proposing them.
            </p>

            <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
              {PLAN_ORDER.map((tier) => {
                const plan = PLANS[tier];
                return (
                  <div key={tier} className="flex flex-col bg-background p-6">
                    <h3 className="text-[15px] font-semibold text-foreground">{plan.name}</h3>
                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{plan.tagline}</p>

                    <p className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-foreground">
                      {plan.indicativePrice === null ? "Custom" : `€${plan.indicativePrice}`}
                      {plan.indicativePrice ? (
                        <span className="text-[13px] font-normal text-muted-foreground"> /month</span>
                      ) : null}
                    </p>

                    <ul className="mt-5 flex-1 space-y-2">
                      <li className="text-[13px] text-muted-foreground">
                        {describeLimit(plan.limits.accounts)} Google Ads{" "}
                        {plan.limits.accounts === 1 ? "account" : "accounts"}
                      </li>
                      {plan.highlights.slice(1).map((highlight) => (
                        <li key={highlight} className="text-[13px] text-muted-foreground">
                          {highlight}
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="mt-6"
                      size="sm"
                      variant={tier === "GROWTH" ? "default" : "outline"}
                      asChild
                    >
                      <Link href="/signup">{tier === "FREE" ? "Start free" : `Choose ${plan.name}`}</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
            See what it finds in your account
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-6 text-muted-foreground">
            The first analysis runs as soon as your data is synced, usually within a few minutes of
            connecting.
          </p>
          <Button size="lg" className="mt-7" asChild>
            <Link href="/signup">
              Create your workspace
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p className="text-[12px] text-muted-foreground">
            © {new Date().getFullYear()} AdLeverage. Not affiliated with Google.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** An illustrative recommendation, labelled as such — not a claim about anyone's account. */
function ExamplePanel() {
  return (
    <div className="rounded-xl border border-border bg-background p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">Example recommendation</span>
        <span className="rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-medium text-positive">
          Low risk
        </span>
      </div>

      <h3 className="mt-4 text-[15px] font-semibold text-foreground">
        Increase budget · Brand Search
      </h3>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        Limited by budget on 26 of the last 30 days at 8.4× ROAS. Raising the daily budget from €50
        to €60 stays inside your 20% limit.
      </p>

      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-4">
        {[
          ["Confidence", "91%"],
          ["Est. monthly", "+€1,240"],
          ["Evidence", "30 days"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-[14px] font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex gap-2">
        <Button size="sm" className="pointer-events-none" tabIndex={-1} aria-hidden>
          Approve
        </Button>
        <Button size="sm" variant="outline" className="pointer-events-none" tabIndex={-1} aria-hidden>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
