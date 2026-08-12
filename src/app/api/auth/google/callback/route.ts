import { NextResponse, type NextRequest } from "next/server";

import { loginWithGoogleIdentity } from "@/lib/auth/service";
import { appUrl } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { decodeState, exchangeCodeForTokens, fetchUserInfo } from "@/lib/google-ads/auth";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db/prisma";

const log = createLogger("auth.google.callback");

function failure(message: string): NextResponse {
  return NextResponse.redirect(appUrl(`/login?error=${encodeURIComponent(message)}`));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  if (params.get("error")) {
    return failure("Google sign-in was cancelled.");
  }

  const code = params.get("code");
  const state = decodeState(params.get("state"));

  if (!code || !state || state.flow !== "login") {
    log.warn("callback rejected: bad state or missing code");
    return failure("That sign-in link was invalid. Please try again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code, "login");
    const profile = await fetchUserInfo(tokens.accessToken);

    const result = await loginWithGoogleIdentity({
      providerAccountId: profile.sub,
      email: profile.email,
      name: profile.name,
      pictureUrl: profile.picture,
      emailVerified: profile.emailVerified,
    });

    if (result.isNewUser) return NextResponse.redirect(appUrl("/onboarding"));

    // Returning users with no connected account still belong in onboarding.
    const accountCount = await prisma.googleAdsAccount.count({
      where: { organizationId: result.organizationId, isActive: true },
    });

    const target = accountCount === 0 ? "/onboarding" : (state.returnTo ?? "/dashboard");
    return NextResponse.redirect(appUrl(target));
  } catch (error) {
    log.error("google sign-in failed", { error });
    return failure(toUserMessage(error));
  }
}
