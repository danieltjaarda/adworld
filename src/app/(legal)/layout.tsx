import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { COMPANY } from "@/lib/legal/company";

/**
 * Legal pages are read, not navigated: one column, generous measure, no product chrome
 * competing for attention. Google's reviewers land here straight from the consent
 * screen, so the header always offers a way back into the product.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
          <Link href="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-[13px] text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-8 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {COMPANY.legalName}. Not affiliated with Google.
          </span>
          <span>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            {" · "}
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
