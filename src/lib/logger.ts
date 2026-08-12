import { getEnv } from "@/lib/env";

/**
 * Structured JSON logging. Anything that looks like a credential is redacted before
 * it reaches stdout — OAuth tokens and API keys must never end up in Vercel logs.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = [
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "refreshtokenencrypted",
  "accesstokenencrypted",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "api_key",
  "client_secret",
  "developertoken",
  "developer_token",
  "sessiontoken",
  "tokenhash",
];

const REDACTED = "[redacted]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.includes(key.toLowerCase()) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

function currentLevel(): LogLevel {
  try {
    return getEnv().LOG_LEVEL;
  } catch {
    return "info";
  }
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

function build(bindings: Record<string, unknown>): Logger {
  const merge = (context?: Record<string, unknown>) => ({ ...bindings, ...context });
  return {
    debug: (message, context) => write("debug", message, merge(context)),
    info: (message, context) => write("info", message, merge(context)),
    warn: (message, context) => write("warn", message, merge(context)),
    error: (message, context) => write("error", message, merge(context)),
    child: (extra) => build({ ...bindings, ...extra }),
  };
}

export const logger = build({});

export function createLogger(scope: string, bindings: Record<string, unknown> = {}): Logger {
  return build({ scope, ...bindings });
}
