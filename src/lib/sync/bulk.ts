import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { parseDateKey } from "@/lib/analytics/date-range";
import { prisma } from "@/lib/db/prisma";
import type { NormalizedDailyMetric, NormalizedSegment } from "@/lib/google-ads/types";

/**
 * Bulk upserts for the two high-volume tables.
 *
 * A 90-day sync of a mid-size account produces tens of thousands of metric rows.
 * Row-by-row Prisma upserts would mean one round trip each, so these paths use
 * multi-row `INSERT ... ON CONFLICT DO UPDATE` statements instead. Everything is
 * parameterized — no string interpolation of values.
 */

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export type MetricRowInput = NormalizedDailyMetric & {
  campaignRowId: string | null;
  adGroupRowId: string | null;
  keywordRowId: string | null;
  adRowId: string | null;
};

export async function bulkUpsertDailyMetrics(
  organizationId: string,
  accountId: string,
  rows: readonly MetricRowInput[],
): Promise<number> {
  let written = 0;

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${accountId}::uuid,
        ${row.level}::"MetricLevel",
        ${row.entityId},
        ${parseDateKey(row.date)}::date,
        ${row.campaignRowId}::uuid,
        ${row.adGroupRowId}::uuid,
        ${row.keywordRowId}::uuid,
        ${row.adRowId}::uuid,
        ${Math.round(row.impressions)}::bigint,
        ${Math.round(row.clicks)}::bigint,
        ${Math.round(row.costMicros)}::bigint,
        ${row.conversions}::double precision,
        ${Math.round(row.conversionValueMicros)}::bigint,
        ${row.allConversions}::double precision,
        ${Math.round(row.allConversionValueMicros)}::bigint,
        ${Math.round(row.interactions)}::bigint,
        ${Math.round(row.videoViews)}::bigint,
        ${row.searchImpressionShare}::decimal,
        ${row.searchBudgetLostImprShare}::decimal,
        ${row.searchRankLostImprShare}::decimal,
        ${row.topImpressionPercentage}::decimal,
        NOW(),
        NOW()
      )`,
    );

    written += await prisma.$executeRaw`
      INSERT INTO "daily_metrics" (
        "id", "organizationId", "accountId", "level", "entityId", "date",
        "campaignRowId", "adGroupRowId", "keywordRowId", "adRowId",
        "impressions", "clicks", "costMicros", "conversions", "conversionValueMicros",
        "allConversions", "allConversionValueMicros", "interactions", "videoViews",
        "searchImpressionShare", "searchBudgetLostImprShare", "searchRankLostImprShare",
        "topImpressionPercentage", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("accountId", "level", "entityId", "date") DO UPDATE SET
        "campaignRowId" = EXCLUDED."campaignRowId",
        "adGroupRowId" = EXCLUDED."adGroupRowId",
        "keywordRowId" = EXCLUDED."keywordRowId",
        "adRowId" = EXCLUDED."adRowId",
        "impressions" = EXCLUDED."impressions",
        "clicks" = EXCLUDED."clicks",
        "costMicros" = EXCLUDED."costMicros",
        "conversions" = EXCLUDED."conversions",
        "conversionValueMicros" = EXCLUDED."conversionValueMicros",
        "allConversions" = EXCLUDED."allConversions",
        "allConversionValueMicros" = EXCLUDED."allConversionValueMicros",
        "interactions" = EXCLUDED."interactions",
        "videoViews" = EXCLUDED."videoViews",
        "searchImpressionShare" = EXCLUDED."searchImpressionShare",
        "searchBudgetLostImprShare" = EXCLUDED."searchBudgetLostImprShare",
        "searchRankLostImprShare" = EXCLUDED."searchRankLostImprShare",
        "topImpressionPercentage" = EXCLUDED."topImpressionPercentage",
        "updatedAt" = NOW()
    `;
  }

  return written;
}

export async function bulkUpsertSegments(
  organizationId: string,
  accountId: string,
  rows: readonly NormalizedSegment[],
): Promise<number> {
  let written = 0;

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${accountId}::uuid,
        ${row.scope}::"SegmentScope",
        ${row.scopeId},
        ${row.segmentType}::"SegmentType",
        ${row.segmentKey},
        ${row.segmentLabel},
        ${parseDateKey(row.date)}::date,
        ${Math.round(row.impressions)}::bigint,
        ${Math.round(row.clicks)}::bigint,
        ${Math.round(row.costMicros)}::bigint,
        ${row.conversions}::double precision,
        ${Math.round(row.conversionValueMicros)}::bigint,
        NOW(),
        NOW()
      )`,
    );

    written += await prisma.$executeRaw`
      INSERT INTO "segment_performance" (
        "id", "organizationId", "accountId", "scope", "scopeId", "segmentType",
        "segmentKey", "segmentLabel", "date", "impressions", "clicks", "costMicros",
        "conversions", "conversionValueMicros", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("accountId", "scope", "scopeId", "segmentType", "segmentKey", "date") DO UPDATE SET
        "segmentLabel" = EXCLUDED."segmentLabel",
        "impressions" = EXCLUDED."impressions",
        "clicks" = EXCLUDED."clicks",
        "costMicros" = EXCLUDED."costMicros",
        "conversions" = EXCLUDED."conversions",
        "conversionValueMicros" = EXCLUDED."conversionValueMicros",
        "updatedAt" = NOW()
    `;
  }

  return written;
}

/** Runs promises with bounded concurrency so a large sync cannot exhaust the pool. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
