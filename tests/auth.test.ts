import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "@/lib/security/crypto";

/**
 * Authentication and the tenant boundary.
 *
 * Sessions are exercised against a cookie jar and a Prisma stub so the important
 * invariants can be asserted directly: the database never holds a usable session token,
 * an expired session is not accepted, and the active organization comes from the user's
 * memberships rather than from anything the browser sent.
 */

type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastActiveAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

type MembershipRow = {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  isDefault: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    currencyCode: string;
    timezone: string;
    onboardingStep: string;
    onboardingDoneAt: Date | null;
  };
};

type AccountRow = {
  id: string;
  organizationId: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isDemo: boolean;
  isManager: boolean;
  isActive: boolean;
  syncStatus: string;
  lastSyncedAt: Date | null;
};

const db = {
  sessions: [] as SessionRow[],
  memberships: [] as MembershipRow[],
  accounts: [] as AccountRow[],
};

const users: Record<string, { id: string; email: string; name: string | null; imageUrl: string | null; emailVerifiedAt: Date | null }> = {
  user_a: { id: "user_a", email: "a@example.com", name: "Ann", imageUrl: null, emailVerifiedAt: new Date() },
};

/** Minimal cookie jar with the same surface the session module uses. */
const jar = new Map<string, { value: string; options: Record<string, unknown> }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // `cache` memoizes per request; in tests each call should see current state.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    session: {
      create: async ({ data }: { data: Omit<SessionRow, "id" | "lastActiveAt"> }) => {
        const row: SessionRow = {
          id: `sess_${db.sessions.length + 1}`,
          lastActiveAt: new Date(),
          ...data,
        };
        db.sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = db.sessions.find((session) => session.tokenHash === where.tokenHash);
        if (!row) return null;
        return { ...row, user: users[row.userId] };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
        const row = db.sessions.find((session) => session.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        db.sessions = db.sessions.filter((session) => session.id !== where.id);
        return null;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = db.sessions.length;
        db.sessions = db.sessions.filter((session) => {
          if (typeof where.tokenHash === "string") return session.tokenHash !== where.tokenHash;
          if (typeof where.userId === "string" && session.userId === where.userId) {
            const except = where.id as { not?: string } | undefined;
            return except?.not ? session.id === except.not : false;
          }
          return true;
        });
        return { count: before - db.sessions.length };
      },
    },
    organizationMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        db.memberships.filter((membership) => membership.userId === where.userId),
    },
    googleAdsAccount: {
      findMany: async ({ where }: { where: { organizationId: string; isActive: boolean } }) =>
        db.accounts.filter(
          (account) => account.organizationId === where.organizationId && account.isActive,
        ),
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        db.accounts.find(
          (account) => account.id === where.id && account.organizationId === where.organizationId,
        ) ?? null,
    },
  },
}));

function organization(id: string, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    currencyCode: "EUR",
    timezone: "Europe/Amsterdam",
    onboardingStep: "DONE",
    onboardingDoneAt: new Date(),
  };
}

function account(id: string, organizationId: string): AccountRow {
  return {
    id,
    organizationId,
    customerId: "1234567890",
    descriptiveName: `Account ${id}`,
    currencyCode: "EUR",
    timeZone: "Europe/Amsterdam",
    isDemo: false,
    isManager: false,
    isActive: true,
    syncStatus: "IDLE",
    lastSyncedAt: null,
  };
}

beforeEach(() => {
  db.sessions = [];
  db.memberships = [];
  db.accounts = [];
  jar.clear();
});

describe("sessions", () => {
  it("stores only a hash, so a database dump cannot be replayed", async () => {
    const { SESSION_COOKIE, createSession } = await import("@/lib/auth/session");
    const token = await createSession("user_a");

    expect(jar.get(SESSION_COOKIE)?.value).toBe(token);
    expect(db.sessions[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(db.sessions)).not.toContain(token);
  });

  it("sets a cookie the browser will not hand to scripts", async () => {
    const { SESSION_COOKIE, createSession } = await import("@/lib/auth/session");
    await createSession("user_a");

    const options = jar.get(SESSION_COOKIE)?.options ?? {};
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("resolves the user for a valid token", async () => {
    const { createSession, getSession } = await import("@/lib/auth/session");
    await createSession("user_a", { ipAddress: "203.0.113.4", userAgent: "vitest" });

    const session = await getSession();
    expect(session?.user.email).toBe("a@example.com");
  });

  it("returns nothing when there is no cookie", async () => {
    const { getSession } = await import("@/lib/auth/session");
    expect(await getSession()).toBeNull();
  });

  it("rejects a token that is not in the database", async () => {
    const { SESSION_COOKIE, getSession } = await import("@/lib/auth/session");
    jar.set(SESSION_COOKIE, { value: "made-up-token", options: {} });

    expect(await getSession()).toBeNull();
  });

  it("rejects an expired session and cleans it up", async () => {
    const { createSession, getSession } = await import("@/lib/auth/session");
    await createSession("user_a");
    db.sessions[0].expiresAt = new Date(Date.now() - 1000);

    expect(await getSession()).toBeNull();
    expect(db.sessions).toHaveLength(0);
  });

  it("extends a session that has been idle, but not on every request", async () => {
    const { createSession, getSession } = await import("@/lib/auth/session");
    vi.useFakeTimers({ now: new Date("2026-08-11T10:00:00Z") });

    try {
      await createSession("user_a");
      const issued = db.sessions[0].expiresAt.getTime();

      // A second request minutes later must not write to the database.
      vi.setSystemTime(new Date("2026-08-11T10:05:00Z"));
      await getSession();
      expect(db.sessions[0].expiresAt.getTime()).toBe(issued);

      // A request the next day rolls the expiry forward.
      vi.setSystemTime(new Date("2026-08-13T10:00:00Z"));
      await getSession();
      expect(db.sessions[0].expiresAt.getTime()).toBeGreaterThan(issued);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the tenant cookies on logout, not just the session", async () => {
    const { ACTIVE_ACCOUNT_COOKIE, ACTIVE_ORG_COOKIE, SESSION_COOKIE, createSession, destroySession, setActiveAccount, setActiveOrganization } =
      await import("@/lib/auth/session");

    await createSession("user_a");
    await setActiveOrganization("org_a");
    await setActiveAccount("acc_a");
    await destroySession();

    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(ACTIVE_ORG_COOKIE)).toBe(false);
    expect(jar.has(ACTIVE_ACCOUNT_COOKIE)).toBe(false);
    expect(db.sessions).toHaveLength(0);
  });

  it("signs out other devices while keeping the current one", async () => {
    const { createSession, destroyAllSessions } = await import("@/lib/auth/session");
    await createSession("user_a");
    await createSession("user_a");
    const keep = db.sessions[1].id;

    const removed = await destroyAllSessions("user_a", keep);

    expect(removed).toBe(1);
    expect(db.sessions.map((session) => session.id)).toEqual([keep]);
  });

  it("drops the selected ads account when the workspace changes", async () => {
    const { ACTIVE_ACCOUNT_COOKIE, setActiveAccount, setActiveOrganization } = await import(
      "@/lib/auth/session"
    );

    await setActiveAccount("acc_from_old_tenant");
    await setActiveOrganization("org_b");

    expect(jar.has(ACTIVE_ACCOUNT_COOKIE)).toBe(false);
  });
});

describe("auth context", () => {
  beforeEach(() => {
    db.memberships = [
      { userId: "user_a", role: "OWNER", isDefault: true, organization: organization("org_a", "Ann Media") },
      { userId: "user_a", role: "VIEWER", isDefault: false, organization: organization("org_b", "Client B") },
    ];
  });

  it("has no context without a session", async () => {
    const { getAuthContext } = await import("@/lib/auth/context");
    expect(await getAuthContext()).toBeNull();
  });

  it("refuses a user who belongs to no workspace", async () => {
    const { createSession } = await import("@/lib/auth/session");
    const { getAuthContext } = await import("@/lib/auth/context");

    db.memberships = [];
    await createSession("user_a");

    expect(await getAuthContext()).toBeNull();
  });

  it("uses the default membership when nothing is selected", async () => {
    const { createSession } = await import("@/lib/auth/session");
    const { getAuthContext } = await import("@/lib/auth/context");
    await createSession("user_a");

    const context = await getAuthContext();
    expect(context?.organization.id).toBe("org_a");
    expect(context?.role).toBe("OWNER");
  });

  it("honours the selected workspace and the role that comes with it", async () => {
    const { createSession, setActiveOrganization } = await import("@/lib/auth/session");
    const { getAuthContext } = await import("@/lib/auth/context");
    await createSession("user_a");
    await setActiveOrganization("org_b");

    const context = await getAuthContext();
    expect(context?.organization.id).toBe("org_b");
    expect(context?.role).toBe("VIEWER");
  });

  it("ignores a cookie naming a workspace the user is not a member of", async () => {
    const { createSession, setActiveOrganization } = await import("@/lib/auth/session");
    const { getAuthContext } = await import("@/lib/auth/context");
    await createSession("user_a");
    await setActiveOrganization("org_someone_else");

    const context = await getAuthContext();
    expect(context?.organization.id).toBe("org_a");
  });
});

describe("account scoping", () => {
  beforeEach(() => {
    db.memberships = [
      { userId: "user_a", role: "OWNER", isDefault: true, organization: organization("org_a", "Ann Media") },
    ];
    db.accounts = [account("acc_a", "org_a"), account("acc_foreign", "org_zzz")];
  });

  async function contextFor() {
    const { createSession } = await import("@/lib/auth/session");
    const { getAuthContext } = await import("@/lib/auth/context");
    await createSession("user_a");
    const context = await getAuthContext();
    if (!context) throw new Error("expected a context");
    return context;
  }

  it("lists only this workspace's accounts", async () => {
    const { listAccounts } = await import("@/lib/auth/context");
    const context = await contextFor();

    const accounts = await listAccounts(context.organization.id);
    expect(accounts.map((entry) => entry.id)).toEqual(["acc_a"]);
  });

  it("treats another tenant's account id as not found", async () => {
    const { requireAccount } = await import("@/lib/auth/context");
    const context = await contextFor();

    await expect(requireAccount(context, "acc_a")).resolves.toMatchObject({ id: "acc_a" });
    await expect(requireAccount(context, "acc_foreign")).rejects.toThrow(/not available/);
    await expect(requireAccount(context, "acc_does_not_exist")).rejects.toThrow(/not available/);
  });

  it("falls back to an owned account when the cookie points elsewhere", async () => {
    const { setActiveAccount } = await import("@/lib/auth/session");
    const { resolveActiveAccount } = await import("@/lib/auth/context");
    const context = await contextFor();

    await setActiveAccount("acc_foreign");
    const active = await resolveActiveAccount(context);

    expect(active?.id).toBe("acc_a");
  });

  it("builds where-clauses that always carry the organization", async () => {
    const { accountScope, tenantScope } = await import("@/lib/auth/context");
    const context = await contextFor();

    expect(tenantScope(context)).toEqual({ organizationId: "org_a" });
    expect(accountScope(context, "acc_a")).toEqual({ organizationId: "org_a", accountId: "acc_a" });
  });
});

describe("permission checks", () => {
  it("stops a viewer from acting and lets an owner through", async () => {
    const { requirePermission } = await import("@/lib/auth/context");
    const base = {
      sessionId: "s",
      user: users.user_a,
      organization: organization("org_a", "Ann Media"),
      memberships: [],
    };

    expect(() => requirePermission({ ...base, role: "OWNER" }, "actions:execute")).not.toThrow();
    expect(() => requirePermission({ ...base, role: "VIEWER" }, "actions:execute")).toThrow(
      /role does not allow/,
    );
  });
});

describe("credential validation", () => {
  it("normalizes the email so casing cannot create a second account", async () => {
    const { emailSchema } = await import("@/lib/auth/validation");
    expect(emailSchema.parse("  Ann@Example.COM ")).toBe("ann@example.com");
  });

  it("rejects an address that is not one", async () => {
    const { emailSchema } = await import("@/lib/auth/validation");
    expect(emailSchema.safeParse("ann@").success).toBe(false);
    expect(emailSchema.safeParse("ann example.com").success).toBe(false);
  });

  it("requires a password with some length and variety", async () => {
    const { passwordSchema } = await import("@/lib/auth/validation");

    expect(passwordSchema.safeParse("short1!").success).toBe(false);
    expect(passwordSchema.safeParse("allletters").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(false);
    expect(passwordSchema.safeParse("correct-horse-9").success).toBe(true);
  });

  it("will not reset a password when the confirmation differs", async () => {
    const { resetPasswordSchema } = await import("@/lib/auth/validation");

    const result = resetPasswordSchema.safeParse({
      token: "a-long-enough-token",
      password: "correct-horse-9",
      confirmPassword: "correct-horse-8",
    });

    expect(result.success).toBe(false);
  });

  it("reports one message per field for the forms", async () => {
    const { fieldErrors, signupSchema } = await import("@/lib/auth/validation");
    const result = signupSchema.safeParse({ name: "", email: "nope", password: "short" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["email", "name", "password"]);
    }
  });
});
