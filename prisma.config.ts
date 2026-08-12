import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * Schema changes need a direct connection: a pooler in transaction mode cannot run DDL,
 * and `CREATE INDEX CONCURRENTLY` requires a session. Managed providers therefore hand
 * out two strings — Neon injects `DATABASE_URL_UNPOOLED` alongside the pooled
 * `DATABASE_URL` — so migrations prefer the direct one and fall back to the pooled URL
 * for a plain local Postgres, where the two are the same thing.
 */
const directUrl = firstSet(
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
);

/**
 * Skips variables that are present but blank. Both .env files and dashboard UIs treat
 * "not set" as an empty string, and a blank DIRECT_URL must not shadow a working
 * DATABASE_URL.
 */
function firstSet(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: directUrl,
  },
});
