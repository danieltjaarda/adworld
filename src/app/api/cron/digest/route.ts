import { NextResponse } from "next/server";

import { runDigestStage } from "@/lib/jobs/digest";
import { authorizeCron } from "@/lib/jobs/cron-auth";
import { createLogger } from "@/lib/logger";

/** Weekly performance email. Scheduled for Monday morning; idempotent per account per day. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("cron.digest");

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runDigestStage();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    log.error("digest stage failed", { error });
    return NextResponse.json({ ok: false, error: "Digest stage failed" }, { status: 500 });
  }
}
