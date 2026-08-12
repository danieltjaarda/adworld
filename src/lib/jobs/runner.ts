import "server-only";

import type { JobType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";

/**
 * Job bookkeeping.
 *
 * Cron on Vercel is at-least-once: the same schedule can fire twice, a deploy can
 * overlap, a timeout can be retried. Every job therefore claims a `runKey` first — a
 * unique row per (job, scope, time bucket). Losing the race means the work is already
 * being done, and the second caller returns without repeating it.
 */

const log = createLogger("jobs");

export type JobOutcome<T> = {
  status: "completed" | "skipped" | "failed";
  runId: string | null;
  result?: T;
  error?: string;
};

export type JobScope = {
  organizationId?: string | null;
  accountId?: string | null;
};

/** Hour bucket by default: two runs in the same hour for the same scope collapse to one. */
export function hourBucket(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

export function dayBucket(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function runKeyFor(type: JobType, scopeId: string, bucket: string): string {
  return `${type}:${scopeId}:${bucket}`;
}

/**
 * Runs `work` at most once per run key. Stats are stored on the run row so the optimizer
 * page can show what a job actually did without a separate log store.
 */
export async function runJob<T extends Prisma.JsonObject>(
  options: {
    type: JobType;
    runKey: string;
    scope?: JobScope;
  },
  work: () => Promise<T>,
): Promise<JobOutcome<T>> {
  const startedAt = Date.now();

  let runId: string;
  try {
    const run = await prisma.jobRun.create({
      data: {
        type: options.type,
        runKey: options.runKey,
        organizationId: options.scope?.organizationId ?? null,
        accountId: options.scope?.accountId ?? null,
        status: "RUNNING",
      },
      select: { id: true },
    });
    runId = run.id;
  } catch {
    // Unique violation: someone else already claimed this bucket.
    log.info("job already claimed", { type: options.type, runKey: options.runKey });
    return { status: "skipped", runId: null };
  }

  try {
    const result = await work();

    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        stats: result,
      },
    });

    return { status: "completed", runId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.jobRun
      .update({
        where: { id: runId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          error: message.slice(0, 500),
        },
      })
      .catch(() => undefined);

    log.error("job failed", { type: options.type, runKey: options.runKey, error });
    return { status: "failed", runId, error: message };
  }
}

/**
 * Accounts a scheduled job should touch: active, not disconnected, and — for live
 * accounts — attached to a healthy connection. Demo accounts are included so the
 * product keeps moving without credentials.
 */
export async function schedulableAccounts(limit = 200) {
  return prisma.googleAdsAccount.findMany({
    where: {
      isActive: true,
      OR: [{ isDemo: true }, { connection: { status: "ACTIVE" } }],
    },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    select: {
      id: true,
      organizationId: true,
      descriptiveName: true,
      timeZone: true,
      isDemo: true,
      lastSyncedAt: true,
    },
  });
}

/**
 * Serialised with a small concurrency: Google Ads and the AI provider both rate-limit,
 * and a serverless function has a wall clock to respect.
 */
export async function forEachAccount<T>(
  accounts: Array<{ id: string; organizationId: string }>,
  worker: (account: { id: string; organizationId: string }) => Promise<T>,
  concurrency = 3,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < accounts.length) {
      const account = accounts[cursor++];
      try {
        await worker(account);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        log.error("account job failed", { accountId: account.id, error });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, accounts.length) }, () => next()),
  );

  return { succeeded, failed };
}
