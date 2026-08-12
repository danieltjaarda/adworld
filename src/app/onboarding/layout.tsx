import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { getAuthContext } from "@/lib/auth/context";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
        <Link href="/dashboard" className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-[13px] text-muted-foreground sm:inline">
            {context.user.email}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[720px]">{children}</div>
      </main>
    </div>
  );
}
