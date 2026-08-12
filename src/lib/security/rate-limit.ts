import "server-only";

import { getEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";

/**
 * Fixed-window rate limiting. Uses Upstash Redis when configured (correct across
 * serverless instances) and falls back to an in-memory window otherwise, which is
 * still enough to stop a single client hammering a route in development.
 */

const log = createLogger("security.rate-limit");

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export type RateLimitRule = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  emailVerification: { limit: 5, windowSeconds: 3600 },
  aiChat: { limit: 30, windowSeconds: 300 },
  aiAnalysis: { limit: 10, windowSeconds: 3600 },
  mutation: { limit: 120, windowSeconds: 60 },
  sync: { limit: 10, windowSeconds: 600 },
  api: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    if (memoryStore.size > 10_000) {
      for (const [k, v] of memoryStore) if (v.resetAt <= now) memoryStore.delete(k);
    }
    return { success: true, limit: rule.limit, remaining: rule.limit - 1, resetAt };
  }

  existing.count += 1;
  const remaining = Math.max(0, rule.limit - existing.count);
  return {
    success: existing.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt: existing.resetAt,
  };
}

async function redisLimit(
  key: string,
  rule: RateLimitRule,
  url: string,
  token: string,
): Promise<RateLimitResult | null> {
  const windowKey = `${key}:${Math.floor(Date.now() / (rule.windowSeconds * 1000))}`;
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", windowKey],
        ["EXPIRE", windowKey, String(rule.windowSeconds), "NX"],
      ]),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{ result?: number }>;
    const count = Number(payload[0]?.result ?? 0);
    if (!count) return null;
    return {
      success: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt: (Math.floor(Date.now() / (rule.windowSeconds * 1000)) + 1) * rule.windowSeconds * 1000,
    };
  } catch (error) {
    log.warn("redis rate limit unavailable, falling back to memory", { error });
    return null;
  }
}

export async function rateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const key = `rl:${name}:${identifier}`;
  const env = getEnv();

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const result = await redisLimit(
      key,
      rule,
      env.UPSTASH_REDIS_REST_URL,
      env.UPSTASH_REDIS_REST_TOKEN,
    );
    if (result) return result;
  }

  return memoryLimit(key, rule);
}

/** Test helper. */
export function clearRateLimitMemory(): void {
  memoryStore.clear();
}
