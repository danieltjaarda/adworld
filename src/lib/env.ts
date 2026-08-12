import "server-only";

import { z } from "zod";

/**
 * Environment access is deliberately lazy and forgiving in development: the app must
 * boot and be usable in demo mode without Google/OpenAI/Stripe credentials. In
 * production the required variables are enforced the first time they are read.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().default(""),
  DIRECT_URL: z.string().optional(),
  /// Direct connection under the names managed providers inject it as. Read by the
  /// Prisma CLI (see prisma.config.ts) for migrations, never by the running app, which
  /// always goes through the pooled DATABASE_URL.
  DATABASE_URL_UNPOOLED: z.string().optional(),
  POSTGRES_URL_NON_POOLING: z.string().optional(),

  AUTH_SECRET: z.string().default(""),
  /// Optional 32-byte key (base64 or hex) for OAuth token encryption. Derived from
  /// AUTH_SECRET when absent so there is one less secret to rotate by hand.
  ENCRYPTION_KEY: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_API_VERSION: z.string().default("v21"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_REASONING_MODEL: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("AdLeverage <noreply@adleverage.app>"),

  CRON_SECRET: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /// Force demo mode even when live credentials exist (useful for screenshots/tests).
  DEMO_MODE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

function parseEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }

  const value = parsed.data;

  if (value.NODE_ENV === "production") {
    const missing = (["DATABASE_URL", "AUTH_SECRET"] as const).filter((key) => !value[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables in production: ${missing.join(", ")}`,
      );
    }
  }

  return value;
}

export function getEnv(): ServerEnv {
  cached ??= parseEnv();
  return cached;
}

/** Test helper — drops the memoized snapshot so a changed process.env is picked up. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Capability flags. Each integration degrades to a mock/no-op provider when its
 * credentials are absent, which is what keeps local development runnable.
 */
export const features = {
  get googleAds(): boolean {
    const env = getEnv();
    return Boolean(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ADS_DEVELOPER_TOKEN,
    );
  },
  get googleLogin(): boolean {
    const env = getEnv();
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  },
  get ai(): boolean {
    return Boolean(getEnv().OPENAI_API_KEY);
  },
  get stripe(): boolean {
    return Boolean(getEnv().STRIPE_SECRET_KEY);
  },
  get email(): boolean {
    return Boolean(getEnv().RESEND_API_KEY);
  },
  get demoMode(): boolean {
    const env = getEnv();
    return env.DEMO_MODE || !features.googleAds;
  },
} as const;

export function appUrl(path = ""): string {
  const base = getEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
