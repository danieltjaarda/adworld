import "server-only";

import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { isProduction } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { generateToken, hashToken } from "@/lib/security/crypto";

const log = createLogger("auth.session");

export const SESSION_COOKIE = "adl_session";
export const ACTIVE_ORG_COOKIE = "adl_org";
export const ACTIVE_ACCOUNT_COOKIE = "adl_account";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24; // extend at most once a day

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  emailVerifiedAt: Date | null;
};

export type ActiveSession = {
  sessionId: string;
  user: SessionUser;
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(Math.floor(SESSION_TTL_MS / 1000)));

  log.info("session created", { userId });
  return token;
}

export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastActiveAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          imageUrl: true,
          emailVerifiedAt: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Rolling expiry, throttled so a busy dashboard does not write on every request.
  if (Date.now() - session.lastActiveAt.getTime() > SESSION_REFRESH_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => undefined);
  }

  return { sessionId: session.id, user: session.user };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
  store.delete(ACTIVE_ORG_COOKIE);
  store.delete(ACTIVE_ACCOUNT_COOKIE);
}

/** Used by "sign out everywhere" in security settings. */
export async function destroyAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
  return result.count;
}

export async function setActiveOrganization(organizationId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, organizationId, cookieOptions(60 * 60 * 24 * 365));
  // The previously selected ads account belongs to the old tenant.
  store.delete(ACTIVE_ACCOUNT_COOKIE);
}

export async function setActiveAccount(accountId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_ACCOUNT_COOKIE, accountId, cookieOptions(60 * 60 * 24 * 365));
}

export async function readActiveOrganizationCookie(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

export async function readActiveAccountCookie(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_ACCOUNT_COOKIE)?.value ?? null;
}
