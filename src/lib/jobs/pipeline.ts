import "server-only";

import { invalidateAccountSummary } from "@/lib/ai/summary";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { detectAnomalies } from "@/lib/optimization/anomalies";
import { analyzeAccount } from "@/lib/optimization/engine";
import { runQueuedActions } from "@/lib/optimization/executor";
import { syncAccount, INCREMENTAL_LOOKBACK_DAYS } from "@/lib/sync/account-sync";
import {
  dayBucket,
  forEachAccount,
  hourBucket,
  runJob,
  runKeyFor,
  schedulableAccounts,
} from "@/lib/jobs/runner";

/**
 * The recurring pipeline.
 *
 * Each stage is a separate cron entry rather than one long job: a serverless function
 * has a time limit, and a failure in analysis should not cost the sync that preceded it.
 * Stages are ordered by schedule, not by chaining, so a missed run self-heals on the
 * next tick instead of blocking everything behind it.
 */

const log = createLogger("jobs.pipeline");

export type StageSummary = {
  accounts: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/** Stage 1 — pull fresh Google Ads data into the warehouse. */
export async function runSyncStage(options: { full?: boolean } = {}): Promise<StageSummary> {
  const accounts = await schedulableAccounts();
  let skipped = 0;

  const outcome = await forEachAccount(accounts, async (account) => {
    const result = await runJob(
      {
        type: "SYNC_ACCOUNT",
        runKey: runKeyFor("SYNC_ACCOUNT", account.id, hourBucket()),
        scope: { organizationId: account.organizationId, accountId: account.id },
      },
      async () => {
        const sync = await syncAccount(account.organizationId, account.id, {
          full: options.full ?? false,
          lookbackDays: options.full ? undefined : INCREMENTAL_LOOKBACK_DAYS,
        });

        await invalidateAccountSummary(account.id);
        return { mode: sync.mode, ...sync.counts };
      },
    );

    if (result.status === "skipped") skipped += 1;
    if (result.status === "failed") throw new Error(result.error);
  });

  return { accounts: accounts.length, ...outcome, skipped };
}

/** Stage 2 — analyse, detect anomalies, and queue whatever automatic mode allows. */
export async function runAnalysisStage(): Promise<StageSummary> {
  const accounts = await schedulableAccounts();
  let skipped = 0;

  const outcome = await forEachAccount(accounts, async (account) => {
    const result = await runJob(
      {
        type: "ANALYZE_ACCOUNT",
        runKey: runKeyFor("ANALYZE_ACCOUNT", account.id, dayBucket()),
        scope: { organizationId: account.organizationId, accountId: account.id },
      },
      async () => {
        const analysis = await analyzeAccount(account.organizationId, account.id, {
          triggeredBy: "cron",
        });
        const anomalies = await detectAnomalies(account.organizationId, account.id);

        return {
          candidates: analysis.candidates,
          created: analysis.created,
          superseded: analysis.superseded,
          autoQueued: analysis.autoQueued,
          usedModel: analysis.usedModel,
          detected: anomalies.created,
          resolved: anomalies.resolved,
        };
      },
    );

    if (result.status === "skipped") skipped += 1;
    if (result.status === "failed") throw new Error(result.error);
  }, 2);

  return { accounts: accounts.length, ...outcome, skipped };
}

/**
 * Stage 3 — drain the action queue.
 *
 * Analysis queues actions; this applies them. Keeping them apart means a Google Ads
 * outage delays execution without losing the reasoning that produced it, and a retry
 * picks up exactly where it stopped.
 */
export async function runExecutionStage(): Promise<StageSummary> {
  const pending = await prisma.aIAction.groupBy({
    by: ["organizationId", "accountId"],
    where: { status: "QUEUED" },
    _count: { _all: true },
  });

  if (pending.length === 0) {
    return { accounts: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let skipped = 0;
  const targets = pending.map((row) => ({
    id: row.accountId,
    organizationId: row.organizationId,
  }));

  const outcome = await forEachAccount(targets, async (account) => {
    const result = await runJob(
      {
        type: "EXECUTE_ACTIONS",
        runKey: runKeyFor("EXECUTE_ACTIONS", account.id, hourBucket()),
        scope: { organizationId: account.organizationId, accountId: account.id },
      },
      async () => {
        const executed = await runQueuedActions(account.organizationId, account.id);
        if (executed.executed > 0) await invalidateAccountSummary(account.id);
        return { ...executed };
      },
    );

    if (result.status === "skipped") skipped += 1;
    if (result.status === "failed") throw new Error(result.error);
  }, 2);

  log.info("execution stage finished", { accounts: targets.length, ...outcome });
  return { accounts: targets.length, ...outcome, skipped };
}
