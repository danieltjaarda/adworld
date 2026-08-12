import { describe, expect, it, vi } from "vitest";

import { can, permissionsFor, ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { createLogger } from "@/lib/logger";
import {
  constantTimeEquals,
  decryptSecret,
  encryptSecret,
  generateToken,
  hashPassword,
  hashToken,
  signPayload,
  stableHash,
  verifyPassword,
  verifySignature,
} from "@/lib/security/crypto";

/**
 * Security primitives: password storage, token handling, OAuth token encryption and the
 * role matrix. These are the pieces where a quiet regression is expensive.
 */

describe("password hashing", () => {
  it("never stores the password itself", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toContain("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("salts, so identical passwords hash differently", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("s3cure-password");

    await expect(verifyPassword("s3cure-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("s3cure-passwore", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("treats unicode-equivalent input as the same password", async () => {
    // "é" composed vs decomposed — different bytes, same password to a human.
    const hash = await hashPassword("caf\u00e9-password");
    await expect(verifyPassword("cafe\u0301-password", hash)).resolves.toBe(true);
  });

  it("returns false rather than throwing on a corrupt stored value", async () => {
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "bcrypt$salt$hash")).resolves.toBe(false);
  });
});

describe("OAuth token encryption", () => {
  it("round-trips a refresh token", () => {
    const token = "1//0gRefreshTokenValueFromGoogle";
    const encrypted = encryptSecret(token);

    expect(encrypted).not.toContain(token);
    expect(decryptSecret(encrypted)).toBe(token);
  });

  it("uses a fresh IV, so the same token never produces the same ciphertext", () => {
    expect(encryptSecret("same-token")).not.toBe(encryptSecret("same-token"));
  });

  it("refuses to decrypt a tampered payload", () => {
    const encrypted = encryptSecret("refresh-token");
    const [version, iv, data, tag] = encrypted.split(".");
    const flipped = data.startsWith("A") ? `B${data.slice(1)}` : `A${data.slice(1)}`;

    expect(() => decryptSecret([version, iv, flipped, tag].join("."))).toThrow();
  });

  it("refuses a payload with a swapped auth tag", () => {
    const [version, iv, data] = encryptSecret("token-one").split(".");
    const otherTag = encryptSecret("token-two").split(".")[3];

    expect(() => decryptSecret([version, iv, data, otherTag].join("."))).toThrow();
  });

  it("rejects malformed input instead of returning garbage", () => {
    expect(() => decryptSecret("")).toThrow();
    expect(() => decryptSecret("v1.only-two-parts")).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
  });
});

describe("opaque tokens", () => {
  it("generates unguessable, url-safe values", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));

    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(43);
    }
  });

  it("hashes deterministically so a lookup by hash works", () => {
    const token = generateToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });

  it("compares without leaking length mismatches as exceptions", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("payload signing", () => {
  it("accepts its own signature and rejects anything else", () => {
    const state = JSON.stringify({ organizationId: "org_1", nonce: "abc" });
    const signature = signPayload(state);

    expect(verifySignature(state, signature)).toBe(true);
    expect(verifySignature(`${state} `, signature)).toBe(false);
    expect(verifySignature(state, "forged-signature")).toBe(false);
  });

  it("produces a stable short hash for dedupe keys", () => {
    expect(stableHash("campaign:123")).toBe(stableHash("campaign:123"));
    expect(stableHash("campaign:123")).toHaveLength(32);
    expect(stableHash("campaign:123")).not.toBe(stableHash("campaign:124"));
  });
});

describe("role permissions", () => {
  it("only lets an owner delete the workspace", () => {
    expect(can("OWNER", "org:delete")).toBe(true);
    expect(can("ADMIN", "org:delete")).toBe(false);
    expect(can("MEMBER", "org:delete")).toBe(false);
    expect(can("VIEWER", "org:delete")).toBe(false);
  });

  it("keeps billing changes with the owner", () => {
    expect(can("OWNER", "billing:manage")).toBe(true);
    expect(can("ADMIN", "billing:manage")).toBe(false);
    expect(can("ADMIN", "billing:read")).toBe(true);
    expect(can("MEMBER", "billing:read")).toBe(false);
  });

  it("stops a viewer from changing anything", () => {
    const writes = [
      "org:manage",
      "team:manage",
      "billing:manage",
      "accounts:manage",
      "settings:manage",
      "recommendations:review",
      "actions:execute",
    ] as const;

    for (const permission of writes) {
      expect(can("VIEWER", permission), `viewer must not have ${permission}`).toBe(false);
    }
  });

  it("gives every role read access to the account data they were invited for", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(can(role, "data:read")).toBe(true);
    }
  });

  it("grants each role a subset of the one above it", () => {
    const owner = new Set(permissionsFor("OWNER"));
    const admin = new Set(permissionsFor("ADMIN"));
    const member = new Set(permissionsFor("MEMBER"));

    for (const permission of permissionsFor("VIEWER")) expect(member.has(permission)).toBe(true);
    for (const permission of permissionsFor("MEMBER")) expect(admin.has(permission)).toBe(true);
    for (const permission of permissionsFor("ADMIN")) expect(owner.has(permission)).toBe(true);
  });

  it("never offers OWNER when inviting, so the seat cannot be handed out by accident", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("OWNER");
  });
});

describe("logging", () => {
  /** Captures what would actually be written to the platform log. */
  function capture(write: (log: ReturnType<typeof createLogger>) => void): string {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      write(createLogger("test"));
      return spy.mock.calls.map((call) => String(call[0])).join("\n");
    } finally {
      spy.mockRestore();
    }
  }

  it("redacts credentials instead of writing them to the platform log", () => {
    const output = capture((log) =>
      log.error("google refresh", {
        userId: "user_1",
        refreshToken: "1//0-super-secret",
        apiKey: "sk-live-123",
        nested: { passwordHash: "scrypt$abc$def" },
      }),
    );

    expect(output).toContain("user_1");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("1//0-super-secret");
    expect(output).not.toContain("sk-live-123");
    expect(output).not.toContain("scrypt$abc$def");
  });

  it("writes one JSON object per line so the platform can parse it", () => {
    const output = capture((log) => log.error("sync failed", { accountId: "acc_1" }));
    const entry = JSON.parse(output) as Record<string, unknown>;

    expect(entry).toMatchObject({ level: "error", message: "sync failed", scope: "test", accountId: "acc_1" });
    expect(typeof entry.time).toBe("string");
  });
});
