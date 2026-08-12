import { NextResponse, type NextRequest } from "next/server";

import { recordAudit } from "@/lib/audit/log";
import { getAuthContext } from "@/lib/auth/context";
import { appUrl } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { decodeState, exchangeCodeForTokens, fetchUserInfo } from "@/lib/google-ads/auth";
import { storeConnectionTokens } from "@/lib/google-ads/tokens";
import { createLogger } from "@/lib/logger";

const log = createLogger("google-ads.callback");

function back(returnTo: string, params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return NextResponse.redirect(appUrl(`${returnTo}${query ? `?${query}` : ""}`));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const state = decodeState(params.get("state"));
  const returnTo = state?.returnTo ?? "/accounts";

  if (params.get("error")) {
    return back(returnTo, { error: "Google Ads access was not granted." });
  }

  const code = params.get("code");
  if (!code || !state || state.flow !== "ads") {
    return back(returnTo, { error: "That authorization link was invalid. Please try again." });
  }

  const context = await getAuthContext();
  if (!context) {
    return NextResponse.redirect(appUrl("/login?next=/accounts"));
  }

  // The signed state carries the tenant that started the flow; a mismatch means the
  // session changed mid-handshake and the tokens must not be stored.
  if (state.organizationId && state.organizationId !== context.organization.id) {
    log.warn("organization mismatch on ads callback", {
      expected: state.organizationId,
      actual: context.organization.id,
    });
    return back(returnTo, { error: "Your workspace changed during authorization. Try again." });
  }

  try {
    const tokens = await exchangeCodeForTokens(code, "ads");

    if (!tokens.refreshToken) {
      return back(returnTo, {
        error:
          "Google did not return long-lived access. Remove AdLeverage from your Google account permissions and connect again.",
      });
    }

    const profile = await fetchUserInfo(tokens.accessToken);

    const connection = await storeConnectionTokens({
      organizationId: context.organization.id,
      googleUserId: profile.sub,
      email: profile.email,
      name: profile.name,
      pictureUrl: profile.picture,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      createdById: context.user.id,
    });

    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      actorLabel: context.user.email,
      action: "google.connected",
      entityType: "google_connection",
      entityId: connection.id,
      summary: `Connected the Google account ${profile.email}`,
    });

    return back(returnTo, { connection: connection.id });
  } catch (error) {
    log.error("google ads connection failed", { error });
    return back(returnTo, { error: toUserMessage(error) });
  }
}
