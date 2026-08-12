import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/jobs/cron-auth";
import { runAnalysisStage } from "@/lib/jobs/pipeline";
import { createLogger } from "@/lib/logger";

/**
 * Daily analysis: rules, AI reasoning, anomaly detection, and queuing whatever the
 * account's automatic settings permit. Once per account per day — running it more often
 * produces the same recommendations against barely-changed data and costs tokens.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("cron.analyze");

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runAnalysisStage();
    log.info("analysis stage finished", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    log.error("analysis stage failed", { error });
    return NextResponse.json({ ok: false, error: "Analysis stage failed" }, { status: 500 });
  }
}
