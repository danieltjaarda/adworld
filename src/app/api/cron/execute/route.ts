import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/jobs/cron-auth";
import { runExecutionStage } from "@/lib/jobs/pipeline";
import { createLogger } from "@/lib/logger";

/**
 * Drains the queue of approved and auto-approved actions into Google Ads. Every action
 * carries an idempotency key, so a retry after a timeout re-checks state rather than
 * applying the same change twice.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("cron.execute");

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runExecutionStage();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    log.error("execution stage failed", { error });
    return NextResponse.json({ ok: false, error: "Execution stage failed" }, { status: 500 });
  }
}
