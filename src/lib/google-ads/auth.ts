import "server-only";

import { getEnv } from "@/lib/env";
import { AppError, errors } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { generateToken, signPayload, verifySignature } from "@/lib/security/crypto";

/**
 * Google OAuth 2.0.
 *
 * Two distinct grants are issued from here:
 *   - sign-in            → openid/email/profile, no refresh token needed
 *   - Google Ads access  → adwords scope, offline access, refresh token stored encrypted
 *
 * Tokens are only ever handled server-side.
 */

const log = createLogger("google.auth");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const LOGIN_SCOPES = ["openid", "email", "profile"] as const;
export const ADS_SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "openid",
  "email",
  "profile",
] as const;

export type OAuthFlow = "login" | "ads";

export function redirectUriFor(flow: OAuthFlow): string {
  const base = getEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return flow === "login"
    ? `${base}/api/auth/google/callback`
    : `${base}/api/google-ads/callback`;
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(
      "GOOGLE_AUTH",
      "Google sign-in is not configured on this deployment.",
      { internalMessage: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing" },
    );
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

// ---------------------------------------------------------------------------
// CSRF-protected state
// ---------------------------------------------------------------------------

export type OAuthState = {
  flow: OAuthFlow;
  nonce: string;
  returnTo?: string;
  organizationId?: string;
};

/** State is signed so a callback cannot be forged or replayed against another tenant. */
export function encodeState(state: Omit<OAuthState, "nonce"> & { nonce?: string }): string {
  const payload: OAuthState = { ...state, nonce: state.nonce ?? generateToken(16) };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

export function decodeState(raw: string | null): OAuthState | null {
  if (!raw) return null;
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature || !verifySignature(encoded, signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    if (parsed.flow !== "login" && parsed.flow !== "ads") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(options: {
  flow: OAuthFlow;
  state: string;
  loginHint?: string;
}): string {
  const { clientId } = requireClientCredentials();
  const scopes = options.flow === "login" ? LOGIN_SCOPES : ADS_SCOPES;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(options.flow),
    response_type: "code",
    scope: scopes.join(" "),
    state: options.state,
    include_granted_scopes: "true",
  });

  if (options.flow === "ads") {
    // A refresh token is only returned with offline access + consent.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  } else {
    params.set("prompt", "select_account");
  }

  if (options.loginHint) params.set("login_hint", options.loginHint);

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  idToken: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || payload.error) {
    log.error("token endpoint rejected request", {
      status: response.status,
      error: payload.error,
      description: payload.error_description,
    });
    if (payload.error === "invalid_grant") {
      throw new AppError(
        "GOOGLE_AUTH",
        "Google rejected the authorization. The connection may have been revoked — reconnect the account.",
      );
    }
    throw new AppError("GOOGLE_AUTH", "Google could not complete the authorization. Please try again.");
  }

  return payload;
}

export async function exchangeCodeForTokens(code: string, flow: OAuthFlow): Promise<TokenSet> {
  const { clientId, clientSecret } = requireClientCredentials();

  const payload = await postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUriFor(flow),
      grant_type: "authorization_code",
    }),
  );

  if (!payload.access_token) {
    throw new AppError("GOOGLE_AUTH", "Google did not return an access token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scopes: payload.scope?.split(" ") ?? [],
    idToken: payload.id_token ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const { clientId, clientSecret } = requireClientCredentials();

  const payload = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  );

  if (!payload.access_token) {
    throw new AppError("GOOGLE_AUTH", "Google did not return a refreshed access token.");
  }

  return {
    accessToken: payload.access_token,
    // Google does not re-issue the refresh token on refresh.
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scopes: payload.scope?.split(" ") ?? [],
    idToken: payload.id_token ?? null,
  };
}

export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
    return response.ok;
  } catch (error) {
    log.warn("token revocation failed", { error });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type GoogleUserInfo = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AppError("GOOGLE_AUTH", "Could not read your Google profile. Please try again.");
  }

  const payload = (await response.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!payload.email) {
    throw errors.badRequest("Your Google account did not share an email address.");
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}
