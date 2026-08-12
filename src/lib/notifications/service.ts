import "server-only";

import type { AnomalySeverity, NotificationType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { alertTemplate } from "@/lib/notifications/templates";

/**
 * In-app notifications with optional email delivery.
 *
 * Every notification carries a dedupe key scoped to the organization, so a cron job
 * that runs twice cannot produce two copies of the same alert.
 */

const log = createLogger("notifications");

export type NotificationInput = {
  organizationId: string;
  accountId?: string | null;
  userId?: string | null;
  type: NotificationType;
  severity?: AnomalySeverity;
  title: string;
  body: string;
  href?: string | null;
  data?: Prisma.InputJsonValue;
  dedupeKey: string;
  email?: { accountName: string } | null;
};

export async function notify(input: NotificationInput): Promise<{ created: boolean }> {
  try {
    const existing = await prisma.notification.findUnique({
      where: {
        organizationId_dedupeKey: {
          organizationId: input.organizationId,
          dedupeKey: input.dedupeKey,
        },
      },
      select: { id: true },
    });

    if (existing) return { created: false };

    const notification = await prisma.notification.create({
      data: {
        organizationId: input.organizationId,
        accountId: input.accountId ?? null,
        userId: input.userId ?? null,
        type: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        data: input.data,
        dedupeKey: input.dedupeKey,
      },
      select: { id: true },
    });

    if (input.email) {
      await deliverEmail(input, notification.id);
    }

    return { created: true };
  } catch (error) {
    log.error("failed to create notification", { error, dedupeKey: input.dedupeKey });
    return { created: false };
  }
}

async function deliverEmail(input: NotificationInput, notificationId: string): Promise<void> {
  const recipients = await prisma.organizationMember.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.userId ? { userId: input.userId } : { role: { in: ["OWNER", "ADMIN"] } }),
    },
    select: { user: { select: { email: true, emailVerifiedAt: true } } },
    take: 10,
  });

  const targets = recipients
    .map((member) => member.user)
    .filter((user) => user.emailVerifiedAt !== null)
    .map((user) => user.email);

  if (targets.length === 0) return;

  await Promise.all(
    targets.map((to) =>
      sendEmail(
        alertTemplate({
          to,
          title: input.title,
          body: input.body,
          accountName: input.email?.accountName ?? "your account",
          url: appUrl(input.href ?? "/dashboard"),
        }),
      ),
    ),
  );

  await prisma.notification
    .update({ where: { id: notificationId }, data: { emailSentAt: new Date() } })
    .catch(() => undefined);
}

export async function markNotificationRead(
  organizationId: string,
  notificationId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, organizationId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(organizationId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { organizationId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function countUnread(organizationId: string): Promise<number> {
  return prisma.notification.count({ where: { organizationId, readAt: null } });
}
