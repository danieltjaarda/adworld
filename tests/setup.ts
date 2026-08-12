import { vi } from "vitest";

/**
 * A deployment-shaped environment for tests: no live credentials, so every integration
 * resolves to its mock provider. Individual tests override what they need.
 */
// `NODE_ENV` is typed as read-only, but the runtime value is what the env parser reads.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL ||= "postgresql://localhost:5432/test";
process.env.AUTH_SECRET ||= "test-secret-value-that-is-long-enough-to-be-usable";
process.env.NEXT_PUBLIC_APP_URL ||= "http://localhost:3000";
process.env.LOG_LEVEL = "error";

/** `import "server-only"` throws outside a server component; tests import those modules. */
vi.mock("server-only", () => ({}));
