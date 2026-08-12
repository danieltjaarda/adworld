import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/**
 * Single Prisma instance per runtime. Serverless invocations reuse the module scope,
 * so the adapter's pool is created once and shared across warm requests.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env and point it at a Postgres instance.",
    );
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new Proxy({} as PrismaClient, {
    get(_target, property, receiver) {
      globalForPrisma.prisma ??= createClient();
      return Reflect.get(globalForPrisma.prisma, property, receiver);
    },
  });

export type { PrismaClient };
