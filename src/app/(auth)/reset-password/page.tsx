import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div>
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">
          This link is incomplete
        </h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          The reset link is missing its token. Request a new one and open it directly from your
          email.
        </p>
        <p className="mt-7 text-[13px]">
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">
        Choose a new password
      </h1>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
        For your security, this will sign you out everywhere else.
      </p>

      <div className="mt-7">
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
