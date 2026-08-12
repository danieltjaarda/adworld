"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth/context";
import { setActiveAccount, setActiveOrganization } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { errors } from "@/lib/errors";

/**
 * Workspace and account switching.
 *
 * The selection lives in a cookie, but the cookie is only ever written after the server
 * has confirmed the user is a member of that organization, or that the account belongs
 * to the active organization.
 */

export async function switchAccountAction(accountId: string): Promise<void> {
  const context = await requireAuth();

  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: accountId, organizationId: context.organization.id, isActive: true },
    select: { id: true },
  });
  if (!account) throw errors.notFound("That account is not available in this workspace.");

  await setActiveAccount(account.id);
  revalidatePath("/", "layout");
}

export async function switchOrganizationAction(organizationId: string): Promise<void> {
  const context = await requireAuth();

  const membership = context.memberships.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!membership) throw errors.forbidden("You are not a member of that workspace.");

  await setActiveOrganization(organizationId);
  redirect("/dashboard");
}
