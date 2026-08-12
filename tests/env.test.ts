import { afterEach, describe, expect, it } from "vitest";

import { features, getEnv, resetEnvCache } from "@/lib/env";

/**
 * The values these tests feed in are what a hosting dashboard hands back after someone
 * pastes a .env file into it: quotes still attached, and "not set" spelled as "".
 */
function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
  }
}

afterEach(() => {
  resetEnvCache();
});

describe("environment parsing", () => {
  it("strips the quotes a pasted .env leaves around a value", () => {
    withEnv({ NEXT_PUBLIC_APP_URL: '"https://example.com"' }, () => {
      expect(getEnv().NEXT_PUBLIC_APP_URL).toBe("https://example.com");
    });
  });

  it("treats a blank value as absent so the default applies", () => {
    withEnv({ EMAIL_FROM: "   " }, () => {
      expect(getEnv().EMAIL_FROM).toBe("AdLeverage <noreply@adleverage.app>");
    });
  });

  it("keeps a quoted log level usable instead of refusing to boot", () => {
    withEnv({ LOG_LEVEL: '"debug"' }, () => {
      expect(getEnv().LOG_LEVEL).toBe("debug");
    });
  });

  it("falls back to info for a level it does not recognise", () => {
    withEnv({ LOG_LEVEL: "verbose" }, () => {
      expect(getEnv().LOG_LEVEL).toBe("info");
    });
  });

  it("does not count empty credentials as a configured integration", () => {
    withEnv(
      { GOOGLE_CLIENT_ID: '""', GOOGLE_CLIENT_SECRET: '""', STRIPE_SECRET_KEY: '""' },
      () => {
        expect(features.googleLogin).toBe(false);
        expect(features.stripe).toBe(false);
        expect(features.demoMode).toBe(true);
      },
    );
  });
});
