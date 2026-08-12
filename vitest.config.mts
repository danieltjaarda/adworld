import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests run in node and never touch a real database or a real API. Anything that would
 * need one is exercised through a mocked Prisma client, which keeps the suite fast
 * enough to run on every commit.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
