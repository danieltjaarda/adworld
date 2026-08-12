"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/components/forms/form-state";
import { invalidateAccountSummary } from "@/lib/ai/summary";
import { recordAudit } from "@/lib/audit/log";
import { requireAuth, requireAuthWith } from "@/lib/auth/context";
import { setActiveAccount } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { errors, toUserMessage } from "@/lib/errors";
import { revokeToken } from "@/lib/google-ads/auth";
import { listAccountsForConnection } from "@/lib/google-ads/provider";
import { getConnectionAccessToken, readRefreshTokenForRevocation } from "@/lib/google-ads/tokens";
import { createLogger } from "@/lib/logger";
import { assertCanAddAccount } from "@/lib/billing/limits";
import { detectAnomalies } from "@/lib/optimization/anomalies";
import { analyzeAccount } from "@/lib/optimization/engine";
import { syncAccount } from "@/lib/sync/account-sync";

/**
 * Account lifecycle: discover what a Google connection can reach, link an account,
 * sync it, analyze it, and disconnect it again. Every mutation re-checks the tenant and
 * the caller's role.
 */

const log = createLogger("accounts.actions");

export type DiscoveredAccount = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isManager: boolean;
  isTestAccount: boolean;
  managerCustomerId: string | null;
  alreadyLinked: boolean;
};

export async function discoverAccountsAction(connectionId: string): Promise<DiscoveredAccount[]> {
  const context = await requireAuthWith("accounts:manage");

  const connection = await prisma.googleConnection.findFirst({
    where: { id: connectionId, organizationId: context.organization.id },
    select: { id: true },
  });
  if (!connection) throw errors.notFound("That Google connection is not available.");

  const credentials = await getConnectionAccessToken(context.organization.id, connectionId);
  const discovered = await listAccountsForConnection(credentials.accessToken);

  const linked = await prisma.googleAdsAccount.findMany({
    where: { organizationId: context.organization.id },
    select: { customerId: true },
  });
  const linkedIds = new Set(linked.map((account) => account.customerId));

  return discovered.map((account) => ({
    customerId: account.customerId,
    descriptiveName: account.descriptiveName,
    currencyCode: account.currencyCode,
    timeZone: account.timeZone,
    isManager: account.isManager,
    isTestAccount: account.isTestAccount,
    managerCustomerId: account.loginCustomerId ?? null,
    alreadyLinked: linkedIds.has(account.customerId),
  }));
}

export async function linkAccountAction(input: {
  connectionId: string;
  customerId: string;
}): Promise<ActionState> {
  try {
    const context = await requireAuthWith("accounts:manage");
    await assertCanAddAccount(context.organization.id);

    const credentials = await getConnectionAccessToken(context.organization.id, input.connectionId);
    const discovered = await listAccountsForConnection(credentials.accessToken);
    const match = discovered.find((account) => account.customerId === input.customerId);

    if (!match) {
      return {
        status: "error",
        message: "That customer id is not reachable with this Google connection.",
      };
    }
    if (match.isManager) {
      return {
        status: "error",
        message:
          "Manager accounts cannot be linked directly. Choose one of the client accounts underneath it.",
      };
    }

    const account = await prisma.googleAdsAccount.upsert({
      where: {
        organizationId_customerId: {
          organizationId: context.organization.id,
          customerId: match.customerId,
        },
      },
      update: {
        connectionId: input.connectionId,
        descriptiveName: match.descriptiveName,
        currencyCode: match.currencyCode,
        timeZone: match.timeZone,
        loginCustomerId: match.loginCustomerId ?? null,
        isTestAccount: match.isTestAccount,
        isActive: true,
      },
      create: {
        organizationId: context.organization.id,
        connectionId: input.connectionId,
        customerId: match.customerId,
        descriptiveName: match.descriptiveName,
        currencyCode: match.currencyCode,
        timeZone: match.timeZone,
        loginCustomerId: match.loginCustomerId ?? null,
        isTestAccount: match.isTestAccount,
        settings: { create: {} },
      },
      select: { id: true, descriptiveName: true },
    });

    await setActiveAccount(account.id);

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "account.linked",
      entityType: "google_ads_account",
      entityId: account.id,
      summary: `Linked Google Ads account ${match.descriptiveName} (${match.customerId})`,
    });

    revalidatePath("/", "layout");
    return { status: "success", message: `${account.descriptiveName} is connected.` };
  } catch (error) {
    log.error("linking account failed", { error });
    return { status: "error", message: toUserMessage(error) };
  }
}

/** Creates the local demo account so the product is explorable without credentials. */
export async function createDemoAccountAction(): Promise<ActionState> {
  try {
    const context = await requireAuthWith("accounts:manage");

    const existing = await prisma.googleAdsAccount.findFirst({
      where: { organizationId: context.organization.id, isDemo: true },
      select: { id: true },
    });

    const account =
      existing ??
      (await prisma.googleAdsAccount.create({
        data: {
          organizationId: context.organization.id,
          customerId: "9999999999",
          descriptiveName: "Demo Account",
          currencyCode: "EUR",
          timeZone: "Europe/Amsterdam",
          isDemo: true,
          settings: { create: { mode: "APPROVAL", targetRoas: 4, grossMarginPct: 55 } },
        },
        select: { id: true },
      }));

    await setActiveAccount(account.id);
    await syncAccount(context.organization.id, account.id, { full: true });
    await analyzeAccount(context.organization.id, account.id, { triggeredBy: "user" });
    await detectAnomalies(context.organization.id, account.id);

    revalidatePath("/", "layout");
    return { status: "success", message: "Demo account ready." };
  } catch (error) {
    log.error("demo account creation failed", { error });
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function syncAccountAction(accountId: string): Promise<ActionState> {
  try {
    const context = await requireAuth();

    const account = await prisma.googleAdsAccount.findFirst({
      where: { id: accountId, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!account) throw errors.notFound("That account is not available.");

    const result = await syncAccount(context.organization.id, accountId, { full: true });
    await analyzeAccount(context.organization.id, accountId, { triggeredBy: "user" });
    await detectAnomalies(context.organization.id, accountId);
    await invalidateAccountSummary(accountId);

    revalidatePath("/", "layout");

    return {
      status: "success",
      message: `Synced ${result.counts.campaigns} campaigns, ${result.counts.keywords} keywords and ${result.counts.dailyMetrics} daily metric rows.`,
    };
  } catch (error) {
    log.error("manual sync failed", { error, accountId });
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function disconnectAccountAction(accountId: string): Promise<ActionState> {
  try {
    const context = await requireAuthWith("accounts:manage");

    const account = await prisma.googleAdsAccount.findFirst({
      where: { id: accountId, organizationId: context.organization.id },
      select: { id: true, descriptiveName: true, customerId: true },
    });
    if (!account) throw errors.notFound("That account is not available.");

    // Deleting cascades to campaigns, metrics, recommendations and actions.
    await prisma.googleAdsAccount.delete({ where: { id: account.id } });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "account.disconnected",
      entityType: "google_ads_account",
      entityId: account.id,
      summary: `Disconnected ${account.descriptiveName} (${account.customerId}) and removed its stored data`,
    });

    revalidatePath("/", "layout");
    return { status: "success", message: `${account.descriptiveName} was disconnected.` };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}

export async function disconnectGoogleConnectionAction(
  connectionId: string,
): Promise<ActionState> {
  try {
    const context = await requireAuthWith("accounts:manage");

    const refreshToken = await readRefreshTokenForRevocation(context.organization.id, connectionId);
    if (refreshToken) await revokeToken(refreshToken);

    await prisma.googleConnection.deleteMany({
      where: { id: connectionId, organizationId: context.organization.id },
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "google.disconnected",
      entityType: "google_connection",
      entityId: connectionId,
      summary: "Revoked a Google connection and deleted its stored tokens",
    });

    revalidatePath("/", "layout");
    return { status: "success", message: "Google access was revoked." };
  } catch (error) {
    return { status: "error", message: toUserMessage(error) };
  }
}
