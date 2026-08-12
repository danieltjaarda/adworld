import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/app/(dashboard)/settings/security/change-password-form";
import { SessionList } from "@/app/(dashboard)/settings/security/session-list";
import { SectionHeader } from "@/components/dashboard/page-header";
import { Surface } from "@/components/dashboard/surface";
import { formatRelativeTime } from "@/lib/analytics/format";
import { getAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Security" };

export default async function SecuritySettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const [user, sessions, recentSecurityEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: context.user.id },
      select: { passwordHash: true },
    }),
    prisma.session.findMany({
      where: { userId: context.user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: "desc" },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: { startsWith: "security." },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, action: true, summary: true, createdAt: true, ipAddress: true },
    }),
  ]);

  return (
    <>
      <Surface>
        <SectionHeader
          title="Password"
          description={
            user?.passwordHash
              ? "Changing your password signs out every other device."
              : "You sign in with Google, so there is no password on this account."
          }
        />
        {user?.passwordHash ? (
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        ) : null}
      </Surface>

      <Surface padded={false}>
        <div className="px-5 py-4">
          <SectionHeader
            title="Active sessions"
            description="Every browser currently signed in as you."
          />
        </div>
        <SessionList
          sessions={sessions.map((session) => ({
            id: session.id,
            current: session.id === context.sessionId,
            device: describeUserAgent(session.userAgent),
            ipAddress: session.ipAddress,
            lastActive: formatRelativeTime(session.lastActiveAt),
            signedIn: formatRelativeTime(session.createdAt),
          }))}
        />
      </Surface>

      {recentSecurityEvents.length > 0 ? (
        <Surface padded={false}>
          <div className="px-5 py-4">
            <SectionHeader title="Recent security activity" />
          </div>
          <ul className="divide-y divide-border">
            {recentSecurityEvents.map((event) => (
              <li key={event.id} className="px-5 py-3">
                <p className="text-[13px]">{event.summary}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {formatRelativeTime(event.createdAt)}
                  {event.ipAddress ? ` · ${event.ipAddress}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </>
  );
}

/** Enough to recognise your own devices, without pretending to be device fingerprinting. */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : "Browser";

  const platform =
    /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Macintosh/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : "Unknown OS";

  return `${browser} on ${platform}`;
}
