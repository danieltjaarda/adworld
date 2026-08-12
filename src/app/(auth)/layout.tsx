import Link from "next/link";

import { Logo } from "@/components/brand/logo";

/**
 * Split layout: the form on the left where the eye lands, a quiet proof panel on the
 * right that disappears entirely on mobile.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <Logo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>

        <footer className="text-[12px] text-muted-foreground">
          <span>© {new Date().getFullYear()} AdLeverage</span>
        </footer>
      </div>

      <aside className="relative hidden border-l border-border bg-canvas lg:flex lg:flex-col lg:justify-center lg:px-16">
        <blockquote className="max-w-md">
          <p className="text-[22px] leading-8 font-medium tracking-[-0.015em] text-foreground">
            &ldquo;It found €740 of wasted search terms in the first hour, then showed me exactly
            which campaign to move that budget into.&rdquo;
          </p>
          <footer className="mt-5 text-[13px] text-muted-foreground">
            Performance lead, e-commerce agency
          </footer>
        </blockquote>

        <dl className="mt-14 grid max-w-md grid-cols-3 gap-6 border-t border-border pt-8">
          {[
            { value: "Every change", label: "logged and reversible" },
            { value: "Hard limits", label: "on budgets and bids" },
            { value: "No guessing", label: "metrics come from your data" },
          ].map((item) => (
            <div key={item.value}>
              <dt className="text-[13px] font-semibold text-foreground">{item.value}</dt>
              <dd className="mt-1 text-[12px] leading-4 text-muted-foreground">{item.label}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
