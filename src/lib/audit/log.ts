import "server-only";

import { headers } from "next/headers";

import type { ActorType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("audit");

export type AuditInput = {
  organizationId: string;
  action: string;
  entityType: string;
  summary: string;
  entityId?: string | null;
  actorType?: ActorType;
  actorUserId?: string | null;
  actorLabel?: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Reads client metadata from the incoming request when available. */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ipAddress =
      forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || null;
    return { ipAddress, userAgent: headerList.get("user-agent") };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Appends to the immutable activity trail. Audit writes never throw: losing a log line
 * must not roll back the user-visible operation, but it is logged loudly.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const meta =
      input.ipAddress === undefined || input.userAgent === undefined
        ? await requestMeta()
        : { ipAddress: input.ipAddress, userAgent: input.userAgent };

    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.actorType ?? "USER",
        actorUserId: input.actorUserId ?? null,
        actorLabel: input.actorLabel ?? (input.actorType === "AI" ? "AI Agent" : "System"),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? meta.ipAddress,
        userAgent: input.userAgent ?? meta.userAgent,
      },
    });
  } catch (error) {
    log.error("failed to write audit log", { error, action: input.action });
  }
}

/** Security-relevant events that are not tied to an organization yet (login, signup). */
export function logSecurityEvent(
  event: string,
  context: Record<string, unknown> = {},
): void {
  log.info(`security.${event}`, context);
}
