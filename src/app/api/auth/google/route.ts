import { NextResponse, type NextRequest } from "next/server";

import { buildAuthorizationUrl, encodeState } from "@/lib/google-ads/auth";
import { appUrl, features } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth.google.start");

/** Starts the sign-in handshake. Sign-in never requests the Google Ads scope. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!features.googleLogin) {
    return NextResponse.redirect(
      appUrl(`/login?error=${encodeURIComponent("Google sign-in is not configured.")}`),
    );
  }

  const requestedNext = request.nextUrl.searchParams.get("next");
  const returnTo =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard";

  try {
    const url = buildAuthorizationUrl({
      flow: "login",
      state: encodeState({ flow: "login", returnTo }),
    });
    return NextResponse.redirect(url);
  } catch (error) {
    log.error("could not build authorization url", { error });
    return NextResponse.redirect(
      appUrl(`/login?error=${encodeURIComponent("Google sign-in is unavailable right now.")}`),
    );
  }
}
