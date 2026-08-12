import "server-only";

import { cache } from "react";

import type { OrganizationRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { errors } from "@/lib/errors";
import { can, type Permission } from "@/lib/auth/rbac";
import {
  getSession,
  readActiveAccountCookie,
  readActiveOrganizationCookie,
  type SessionUser,
} from "@/lib/auth/session";

/**
 * The tenant boundary.
 *
 * Nothing in the application reads an organization id from the client. The active
 * organization is resolved from the session's memberships, and every scoped query
 * helper below injects `organizationId` so a crafted id from the browser can only
 * ever produce a 404.
 */

export type MembershipSummary = {
  organizationId: string;
  name: string;
  slug: string;
  role: OrganizationRole;
};

export type AuthContext = {
  sessionId: string;
  user: SessionUser;
  organization: {
    id: string;
    name: string;
    slug: string;
    currencyCode: string;
    timezone: string;
    onboardingStep: string;
    onboardingDoneAt: Date | null;
  };
  role: OrganizationRole;
  memberships: MembershipSummary[];
};

/** Deduplicated per request by React cache. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      isDefault: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          currencyCode: true,
          timezone: true,
          onboardingStep: true,
          onboardingDoneAt: true,
        },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (memberships.length === 0) return null;

  const requestedOrgId = await readActiveOrganizationCookie();
  const active =
    memberships.find((membership) => membership.organization.id === requestedOrgId) ??
    memberships[0];

  return {
    sessionId: session.sessionId,
    user: session.user,
    organization: active.organization,
    role: active.role,
    memberships: memberships.map((membership) => ({
      organizationId: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
    })),
  };
});

export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw errors.unauthorized();
  return context;
}

export function requirePermission(context: AuthContext, permission: Permission): void {
  if (!can(context.role, permission)) {
    throw errors.forbidden("Your role does not allow this action.");
  }
}

export async function requireAuthWith(permission: Permission): Promise<AuthContext> {
  const context = await requireAuth();
  requirePermission(context, permission);
  return context;
}

// ---------------------------------------------------------------------------
// Google Ads account scoping
// ---------------------------------------------------------------------------

export type AccountSummary = {
  id: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isDemo: boolean;
  isManager: boolean;
  syncStatus: string;
  lastSyncedAt: Date | null;
};

export const listAccounts = cache(async (organizationId: string): Promise<AccountSummary[]> => {
  const accounts = await prisma.googleAdsAccount.findMany({
    where: { organizationId, isActive: true },
    select: {
      id: true,
      customerId: true,
      descriptiveName: true,
      currencyCode: true,
      timeZone: true,
      isDemo: true,
      isManager: true,
      syncStatus: true,
      lastSyncedAt: true,
    },
    orderBy: [{ isDemo: "asc" }, { createdAt: "asc" }],
  });
  return accounts;
});

/**
 * Loads an account **only** if it belongs to the caller's organization. A foreign or
 * unknown id is indistinguishable from the outside: both produce "not found".
 */
export async function requireAccount(
  context: AuthContext,
  accountId: string,
): Promise<AccountSummary> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId: context.organization.id },
    select: {
      id: true,
      customerId: true,
      descriptiveName: true,
      currencyCode: true,
      timeZone: true,
      isDemo: true,
      isManager: true,
      syncStatus: true,
      lastSyncedAt: true,
    },
  });
  if (!account) throw errors.notFound("That Google Ads account is not available.");
  return account;
}

/**
 * Resolves which account the dashboard should show: the cookie selection when it is
 * valid for this tenant, otherwise the first account. Read-only — cookies are written
 * from server actions, never from render.
 */
export async function resolveActiveAccount(
  context: AuthContext,
  requestedAccountId?: string | null,
): Promise<AccountSummary | null> {
  const accounts = await listAccounts(context.organization.id);
  if (accounts.length === 0) return null;

  const cookieAccountId = requestedAccountId ?? (await readActiveAccountCookie());
  const match = accounts.find((account) => account.id === cookieAccountId);
  return match ?? accounts[0];
}

/** Tenant-scoped `where` fragment for any table carrying organizationId. */
export function tenantScope(context: AuthContext): { organizationId: string } {
  return { organizationId: context.organization.id };
}

export function accountScope(
  context: AuthContext,
  accountId: string,
): { organizationId: string; accountId: string } {
  return { organizationId: context.organization.id, accountId };
}
