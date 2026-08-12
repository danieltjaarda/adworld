import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AcceptInvitation } from "@/app/invite/[token]/accept";
import { Logo } from "@/components/brand/logo";
import { getAuthContext } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { hashToken } from "@/lib/security/crypto";

export const metadata: Metadata = { title: "Join a workspace" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  const context = await getAuthContext();

  if (!invitation || invitation.revokedAt) {
    return <Shell title="This invitation is no longer valid" body="Ask whoever invited you to send a new one." />;
  }
  if (invitation.acceptedAt) {
    return (
      <Shell
        title="This invitation was already used"
        body="If it was you, sign in and switch workspaces from the account menu."
        action={{ href: "/login", label: "Sign in" }}
      />
    );
  }
  if (invitation.expiresAt < new Date()) {
    return <Shell title="This invitation has expired" body="Invitations are valid for 7 days. Ask for a fresh one." />;
  }

  if (!context) {
    const next = encodeURIComponent(`/invite/${token}`);
    redirect(`/login?next=${next}&invited=${encodeURIComponent(invitation.email)}`);
  }

  const alreadyMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: invitation.organization.id,
        userId: context.user.id,
      },
    },
    select: { id: true },
  });
  if (alreadyMember) redirect("/dashboard");

  const inviter = invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? "Someone";
  const emailMatches = context.user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Shell
      title={`Join ${invitation.organization.name}`}
      body={`${inviter} invited ${invitation.email} to join as ${ROLE_LABELS[invitation.role]}.`}
    >
      {emailMatches ? (
        <AcceptInvitation token={token} organizationName={invitation.organization.name} />
      ) : (
        <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-[13px] leading-5 text-warning">
          This invitation was sent to {invitation.email}, but you are signed in as{" "}
          {context.user.email}. Sign in with the invited address to accept it.
        </p>
      )}
    </Shell>
  );
}

function Shell({
  title,
  body,
  action,
  children,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-7 shadow-card">
        <Logo />
        <h1 className="mt-6 text-[20px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{body}</p>

        <div className="mt-5">
          {children}
          {action ? (
            <Link
              href={action.href}
              className="text-[13px] font-medium text-primary underline-offset-4 hover:underline"
            >
              {action.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
