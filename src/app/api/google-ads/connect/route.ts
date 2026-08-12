import { NextResponse, type NextRequest } from "next/server";

import { requireAuthWith } from "@/lib/auth/context";
import { appUrl, features } from "@/lib/env";
import { buildAuthorizationUrl, encodeState } from "@/lib/google-ads/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("google-ads.connect");

/**
 * Starts the Google Ads authorization. Unlike sign-in this requests offline access,
 * because the sync jobs need to call the API while nobody is looking at the dashboard.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = await requireAuthWith("accounts:manage");

  const requestedNext = request.nextUrl.searchParams.get("next");
  const returnTo =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/accounts";

  if (!features.googleAds) {
    return NextResponse.redirect(
      appUrl(
        `${returnTo}?error=${encodeURIComponent(
          "Google Ads is not configured on this deployment. You can still explore the demo account.",
        )}`,
      ),
    );
  }

  try {
    const url = buildAuthorizationUrl({
      flow: "ads",
      state: encodeState({
        flow: "ads",
        returnTo,
        organizationId: context.organization.id,
      }),
      loginHint: context.user.email,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    log.error("could not start google ads authorization", { error });
    return NextResponse.redirect(
      appUrl(`${returnTo}?error=${encodeURIComponent("Could not reach Google. Try again shortly.")}`),
    );
  }
}
