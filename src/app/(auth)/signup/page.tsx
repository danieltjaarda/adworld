import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupForm } from "@/app/(auth)/signup/signup-form";
import { GoogleAuthButton } from "@/components/auth/google-button";
import { getAuthContext } from "@/lib/auth/context";
import { features } from "@/lib/env";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage() {
  const context = await getAuthContext();
  if (context) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">
        Create your account
      </h1>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
        Connect Google Ads and see where your budget is going in a few minutes.
      </p>

      <div className="mt-7 space-y-5">
        {features.googleLogin ? (
          <>
            <GoogleAuthButton label="Sign up with Google" />
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[12px] text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        <SignupForm />
      </div>

      <p className="mt-6 text-[12px] leading-5 text-muted-foreground">
        By creating an account you agree to our terms of service and privacy policy. We only
        request the Google Ads permissions needed to read and optimize the accounts you connect.
      </p>

      <p className="mt-6 text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
