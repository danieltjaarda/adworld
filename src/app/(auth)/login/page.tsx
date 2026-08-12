import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { GoogleAuthButton } from "@/components/auth/google-button";
import { getAuthContext } from "@/lib/auth/context";
import { features } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string; verified?: string }>;
}) {
  const context = await getAuthContext();
  if (context) redirect("/dashboard");

  const params = await searchParams;

  return (
    <div>
      <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
        Welcome back. Pick up where your accounts left off.
      </p>

      {params.reset ? (
        <p className="mt-5 rounded-md border border-positive/20 bg-positive-soft px-3 py-2 text-[13px] text-positive">
          Your password has been changed. Sign in with your new password.
        </p>
      ) : null}

      {params.verified ? (
        <p className="mt-5 rounded-md border border-positive/20 bg-positive-soft px-3 py-2 text-[13px] text-positive">
          Your email address is confirmed.
        </p>
      ) : null}

      {params.error ? (
        <p className="mt-5 rounded-md border border-negative/20 bg-negative-soft px-3 py-2 text-[13px] text-negative">
          {decodeURIComponent(params.error)}
        </p>
      ) : null}

      <div className="mt-7 space-y-5">
        {features.googleLogin ? (
          <>
            <GoogleAuthButton next={params.next} />
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[12px] text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        <LoginForm next={params.next} />
      </div>

      <p className="mt-7 text-[13px] text-muted-foreground">
        New to AdLeverage?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
