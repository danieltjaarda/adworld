import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";

import { ResendVerification } from "@/app/(auth)/verify-email/resend";
import { getAuthContext } from "@/lib/auth/context";
import { verifyEmailToken } from "@/lib/auth/service";
import { toUserMessage } from "@/lib/errors";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const context = await getAuthContext();

  if (token) {
    const failure = await consumeToken(token);

    if (!failure) {
      return (
        <Outcome
          tone="success"
          title="Email confirmed"
          body="Your address is verified, so alerts and reports can reach you."
          action={{
            href: context ? "/dashboard" : "/login?verified=1",
            label: context ? "Go to dashboard" : "Sign in",
          }}
        />
      );
    }

    return (
      <Outcome
        tone="error"
        title="That link is no longer valid"
        body={failure}
        action={context ? undefined : { href: "/login", label: "Back to sign in" }}
        footer={context ? <ResendVerification /> : undefined}
      />
    );
  }

  if (context?.user.emailVerifiedAt) {
    return (
      <Outcome
        tone="success"
        title="You are all set"
        body="This email address is already confirmed."
        action={{ href: "/dashboard", label: "Go to dashboard" }}
      />
    );
  }

  return (
    <Outcome
      tone="pending"
      title="Confirm your email address"
      body={
        context
          ? `We sent a confirmation link to ${context.user.email}. Open it to enable alerts and reports.`
          : "Open the confirmation link we emailed you. It expires after 24 hours."
      }
      footer={context ? <ResendVerification /> : undefined}
      action={context ? { href: "/dashboard", label: "Continue to dashboard" } : undefined}
    />
  );
}

/** Returns null on success, or the message to show when the token is not usable. */
async function consumeToken(token: string): Promise<string | null> {
  try {
    await verifyEmailToken(token);
    return null;
  } catch (error) {
    return toUserMessage(error);
  }
}

function Outcome({
  tone,
  title,
  body,
  action,
  footer,
}: {
  tone: "success" | "error" | "pending";
  title: string;
  body: string;
  action?: { href: string; label: string };
  footer?: React.ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : MailCheck;
  const toneClass =
    tone === "success"
      ? "bg-positive-soft text-positive"
      : tone === "error"
        ? "bg-negative-soft text-negative"
        : "bg-info-soft text-info";

  return (
    <div>
      <span className={`inline-flex size-10 items-center justify-center rounded-full ${toneClass}`}>
        <Icon className="size-5" aria-hidden />
      </span>

      <h1 className="mt-5 text-[24px] leading-8 font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">{body}</p>

      {action ? (
        <p className="mt-7 text-[13px]">
          <Link
            href={action.href}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {action.label}
          </Link>
        </p>
      ) : null}

      {footer ? <div className="mt-6">{footer}</div> : null}
    </div>
  );
}
