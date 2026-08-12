import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/jobs/cron-auth";
import { runSyncStage } from "@/lib/jobs/pipeline";
import { createLogger } from "@/lib/logger";

/**
 * Hourly Google Ads sync. A full sync (which also reconciles removed entities) runs at
 * night; the rest of the day is a 14-day incremental window, which is where restatements
 * of conversions land.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("cron.sync");

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const hour = new Date().getUTCHours();
  const full = hour === 3;

  try {
    const summary = await runSyncStage({ full });
    log.info("sync stage finished", { full, ...summary });
    return NextResponse.json({ ok: true, full, ...summary });
  } catch (error) {
    log.error("sync stage failed", { error });
    return NextResponse.json({ ok: false, error: "Sync stage failed" }, { status: 500 });
  }
}
