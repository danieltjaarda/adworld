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
const directUrl =
  process.env["DIRECT_URL"] ??
  process.env["DATABASE_URL_UNPOOLED"] ??
  process.env["POSTGRES_URL_NON_POOLING"] ??
  process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: directUrl,
  },
});
