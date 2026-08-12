import "server-only";

import { NextResponse } from "next/server";

import { getEnv, isProduction } from "@/lib/env";
import { constantTimeEquals } from "@/lib/security/crypto";

/**
 * Cron endpoints are public URLs, so they authenticate with a shared secret. Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET`; the same header works for a manual trigger
 * during development.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const secret = getEnv().CRON_SECRET;

  if (!secret) {
    // Without a secret an open endpoint would let anyone burn API quota and money.
    if (isProduction()) {
      return NextResponse.json({ error: "Cron is not configured." }, { status: 503 });
    }
    return null;
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
