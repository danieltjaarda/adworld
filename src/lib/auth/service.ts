import "server-only";

import type { OrganizationRole } from "@/generated/prisma/enums";
import { logSecurityEvent, recordAudit, requestMeta } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/env";
import { errors } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { passwordResetTemplate, verifyEmailTemplate } from "@/lib/notifications/templates";
import { createSession, destroyAllSessions } from "@/lib/auth/session";
import { generateToken, hashPassword, hashToken, verifyPassword } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { slugify } from "@/lib/utils";

const log = createLogger("auth.service");

const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

/** Dummy hash used to keep login timing constant for unknown emails. */
const DUMMY_HASH =
  "scrypt$AAAAAAAAAAAAAAAAAAAAAA$Y1JmY2Q2ZmY0YmM2ZDk3YmQ2ZjM4YTk4YzMyNGJhZjM0ZDA5ZTk5ZjIzNDQ1Y2Y";

async function uniqueSlug(base: string): Promise<string> {
  const seed = slugify(base) || "workspace";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}-${generateToken(3).toLowerCase()}`;
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`;
}

export type SignupResult = {
  userId: string;
  organizationId: string;
};

/**
 * Creates the user, their first workspace and a free subscription in one transaction,
 * then kicks off email verification. The account is usable immediately — verification
 * gates email delivery, not access.
 */
export async function signup(input: {
  name: string;
  email: string;
  password: string;
  organizationName?: string;
}): Promise<SignupResult> {
  const limit = await rateLimit("signup", input.email);
  if (!limit.success) throw errors.rateLimited("Too many sign-up attempts. Try again later.");

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw errors.conflict("An account with this email already exists. Try signing in instead.");
  }

  const passwordHash = await hashPassword(input.password);
  const workspaceName =
    input.organizationName?.trim() ||
    `${input.name.split(" ")[0]}'s workspace`.replace(/^'s /, "My ");
  const slug = await uniqueSlug(workspaceName);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: { id: true, email: true },
    });

    const organization = await tx.organization.create({
      data: {
        name: workspaceName,
        slug,
        members: { create: { userId: user.id, role: "OWNER", isDefault: true } },
        subscription: { create: { plan: "FREE", status: "ACTIVE" } },
      },
      select: { id: true },
    });

    return { userId: user.id, organizationId: organization.id };
  });

  await recordAudit({
    organizationId: result.organizationId,
    actorType: "USER",
    actorUserId: result.userId,
    actorLabel: input.email,
    action: "auth.signup",
    entityType: "user",
    entityId: result.userId,
    summary: `${input.email} created the workspace ${workspaceName}`,
  });

  logSecurityEvent("signup", { userId: result.userId });
  await sendVerificationEmail(result.userId, input.email);

  const meta = await requestMeta();
  await createSession(result.userId, meta);

  return result;
}

export async function login(input: { email: string; password: string }): Promise<{ userId: string }> {
  const limit = await rateLimit("login", input.email);
  if (!limit.success) {
    throw errors.rateLimited("Too many sign-in attempts. Please wait a few minutes.");
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, email: true },
  });

  // Always run a verification so response time does not reveal whether the email exists.
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !valid) {
    logSecurityEvent("login.failed", { email: input.email });
    throw errors.badRequest("That email and password combination is not correct.");
  }

  const meta = await requestMeta();
  await createSession(user.id, meta);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  logSecurityEvent("login.success", { userId: user.id });
  return { userId: user.id };
}

/**
 * Finds or provisions a user from a verified Google identity. Google-verified emails
 * skip the verification step.
 */
export async function loginWithGoogleIdentity(identity: {
  providerAccountId: string;
  email: string;
  name?: string | null;
  pictureUrl?: string | null;
  emailVerified: boolean;
}): Promise<{ userId: string; organizationId: string; isNewUser: boolean }> {
  const email = identity.email.toLowerCase();

  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: identity.providerAccountId } },
    select: { userId: true },
  });

  if (existingAccount) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: existingAccount.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { organizationId: true },
    });
    const meta = await requestMeta();
    await createSession(existingAccount.userId, meta);
    await prisma.user.update({
      where: { id: existingAccount.userId },
      data: { lastLoginAt: new Date() },
    });
    logSecurityEvent("login.google", { userId: existingAccount.userId });
    return {
      userId: existingAccount.userId,
      organizationId: membership?.organizationId ?? "",
      isNewUser: false,
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    // Link the Google identity to the existing password account.
    await prisma.oAuthAccount.create({
      data: {
        userId: existingUser.id,
        provider: "google",
        providerAccountId: identity.providerAccountId,
        email,
      },
    });
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: existingUser.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { organizationId: true },
    });
    const meta = await requestMeta();
    await createSession(existingUser.id, meta);
    logSecurityEvent("login.google.linked", { userId: existingUser.id });
    return {
      userId: existingUser.id,
      organizationId: membership?.organizationId ?? "",
      isNewUser: false,
    };
  }

  const displayName = identity.name?.trim() || email.split("@")[0];
  const workspaceName = `${displayName.split(" ")[0]}'s workspace`;
  const slug = await uniqueSlug(workspaceName);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: displayName,
        imageUrl: identity.pictureUrl ?? null,
        emailVerifiedAt: identity.emailVerified ? new Date() : null,
        oauthAccounts: {
          create: { provider: "google", providerAccountId: identity.providerAccountId, email },
        },
      },
      select: { id: true },
    });

    const organization = await tx.organization.create({
      data: {
        name: workspaceName,
        slug,
        members: { create: { userId: user.id, role: "OWNER", isDefault: true } },
        subscription: { create: { plan: "FREE", status: "ACTIVE" } },
      },
      select: { id: true },
    });

    return { userId: user.id, organizationId: organization.id };
  });

  const meta = await requestMeta();
  await createSession(created.userId, meta);

  await recordAudit({
    organizationId: created.organizationId,
    actorType: "USER",
    actorUserId: created.userId,
    actorLabel: email,
    action: "auth.signup.google",
    entityType: "user",
    entityId: created.userId,
    summary: `${email} signed up with Google`,
  });

  return { ...created, isNewUser: true };
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const limit = await rateLimit("emailVerification", email);
  if (!limit.success) return;

  await prisma.verificationToken.deleteMany({
    where: { userId, type: "EMAIL_VERIFICATION", usedAt: null },
  });

  const token = generateToken(32);
  await prisma.verificationToken.create({
    data: {
      userId,
      type: "EMAIL_VERIFICATION",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    },
  });

  const url = appUrl(`/verify-email?token=${token}`);
  await sendEmail(verifyEmailTemplate(email, url));
  log.info("verification email dispatched", { userId });
}

export async function verifyEmailToken(token: string): Promise<{ userId: string }> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.type !== "EMAIL_VERIFICATION" || record.usedAt) {
    throw errors.badRequest("This confirmation link is no longer valid. Request a new one.");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw errors.badRequest("This confirmation link has expired. Request a new one.");
  }

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);

  logSecurityEvent("email.verified", { userId: record.userId });
  return { userId: record.userId };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** Always succeeds from the caller's point of view — never reveals account existence. */
export async function requestPasswordReset(email: string): Promise<void> {
  const limit = await rateLimit("passwordReset", email);
  if (!limit.success) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    logSecurityEvent("password.reset.unknown_email");
    return;
  }

  await prisma.verificationToken.deleteMany({
    where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null },
  });

  const token = generateToken(32);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: "PASSWORD_RESET",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  await sendEmail(passwordResetTemplate(email, appUrl(`/reset-password?token=${token}`)));
  logSecurityEvent("password.reset.requested", { userId: user.id });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.type !== "PASSWORD_RESET" || record.usedAt) {
    throw errors.badRequest("This reset link is no longer valid. Request a new one.");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw errors.badRequest("This reset link has expired. Request a new one.");
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
  ]);

  // A password change invalidates every existing session.
  await destroyAllSessions(record.userId);
  logSecurityEvent("password.reset.completed", { userId: record.userId });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    throw errors.badRequest("Your account signs in with Google. Set a password from support.");
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw errors.badRequest("Your current password is not correct.");

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await destroyAllSessions(userId, keepSessionId);
  logSecurityEvent("password.changed", { userId });
}

// ---------------------------------------------------------------------------
// Membership helpers
// ---------------------------------------------------------------------------

export async function addMember(
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<void> {
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    update: { role },
    create: { organizationId, userId, role },
  });
}
