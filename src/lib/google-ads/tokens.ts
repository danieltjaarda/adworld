import "server-only";

import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { refreshAccessToken } from "@/lib/google-ads/auth";

/**
 * Encrypted token custody.
 *
 * Refresh tokens are written once at connect time and only ever read here. Callers get
 * a short-lived access token and never see the refresh token, which is also why this
 * module has no client-facing exports.
 */

const log = createLogger("google.tokens");

/** Refresh a little before expiry so an in-flight sync never trips over it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type ConnectionCredentials = {
  connectionId: string;
  organizationId: string;
  accessToken: string;
  email: string;
};

export async function storeConnectionTokens(input: {
  organizationId: string;
  googleUserId: string;
  email: string;
  name?: string | null;
  pictureUrl?: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
  createdById?: string | null;
}): Promise<{ id: string }> {
  const encryptedRefresh = encryptSecret(input.refreshToken);
  const encryptedAccess = encryptSecret(input.accessToken);

  const connection = await prisma.googleConnection.upsert({
    where: {
      organizationId_googleUserId: {
        organizationId: input.organizationId,
        googleUserId: input.googleUserId,
      },
    },
    update: {
      email: input.email,
      name: input.name ?? null,
      pictureUrl: input.pictureUrl ?? null,
      accessTokenEncrypted: encryptedAccess,
      refreshTokenEncrypted: encryptedRefresh,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scopes: input.scopes,
      status: "ACTIVE",
      lastError: null,
      lastRefreshedAt: new Date(),
    },
    create: {
      organizationId: input.organizationId,
      googleUserId: input.googleUserId,
      email: input.email,
      name: input.name ?? null,
      pictureUrl: input.pictureUrl ?? null,
      accessTokenEncrypted: encryptedAccess,
      refreshTokenEncrypted: encryptedRefresh,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scopes: input.scopes,
      status: "ACTIVE",
      createdById: input.createdById ?? null,
    },
    select: { id: true },
  });

  return connection;
}

/**
 * Returns a valid access token for a connection, refreshing transparently.
 * The `organizationId` argument is mandatory: it keeps token access tenant-scoped.
 */
export async function getConnectionAccessToken(
  organizationId: string,
  connectionId: string,
): Promise<ConnectionCredentials> {
  const connection = await prisma.googleConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: {
      id: true,
      organizationId: true,
      email: true,
      status: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      accessTokenExpiresAt: true,
    },
  });

  if (!connection) {
    throw new AppError("GOOGLE_AUTH", "This Google connection is no longer available.");
  }
  if (connection.status === "REVOKED") {
    throw new AppError(
      "GOOGLE_AUTH",
      "Access to this Google account was revoked. Reconnect it to continue syncing.",
    );
  }

  const stillValid =
    connection.accessTokenEncrypted &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();

  if (stillValid && connection.accessTokenEncrypted) {
    return {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      accessToken: decryptSecret(connection.accessTokenEncrypted),
      email: connection.email,
    };
  }

  try {
    const refreshed = await refreshAccessToken(decryptSecret(connection.refreshTokenEncrypted));

    await prisma.googleConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptSecret(refreshed.accessToken),
        accessTokenExpiresAt: refreshed.expiresAt,
        ...(refreshed.refreshToken
          ? { refreshTokenEncrypted: encryptSecret(refreshed.refreshToken) }
          : {}),
        status: "ACTIVE",
        lastError: null,
        lastRefreshedAt: new Date(),
      },
    });

    log.info("access token refreshed", { connectionId: connection.id });

    return {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      accessToken: refreshed.accessToken,
      email: connection.email,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    await prisma.googleConnection.update({
      where: { id: connection.id },
      data: { status: "EXPIRED", lastError: message.slice(0, 500) },
    });
    log.error("token refresh failed", { connectionId: connection.id, error });
    throw new AppError(
      "GOOGLE_AUTH",
      "We lost access to this Google account. Reconnect it from Google Ads accounts.",
    );
  }
}

export async function markConnectionRevoked(connectionId: string): Promise<void> {
  await prisma.googleConnection
    .update({ where: { id: connectionId }, data: { status: "REVOKED" } })
    .catch(() => undefined);
}

/** Used when disconnecting: revoke upstream, then forget the secret material. */
export async function readRefreshTokenForRevocation(
  organizationId: string,
  connectionId: string,
): Promise<string | null> {
  const connection = await prisma.googleConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: { refreshTokenEncrypted: true },
  });
  if (!connection) return null;
  try {
    return decryptSecret(connection.refreshTokenEncrypted);
  } catch {
    return null;
  }
}
