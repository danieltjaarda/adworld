"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { deleteThread, runAgentTurn } from "@/lib/ai/chat";
import { requireAuthWith, resolveActiveAccount } from "@/lib/auth/context";
import { assertWithinUsage, recordUsage } from "@/lib/billing/limits";
import { errors, toUserMessage } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai.actions");

const askSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  threadId: z.string().uuid().nullable().optional(),
});

export type AskResult =
  | { ok: true; threadId: string; answer: string; toolsUsed: string[]; usedModel: boolean }
  | { ok: false; message: string };

export async function askAgentAction(input: z.input<typeof askSchema>): Promise<AskResult> {
  try {
    const context = await requireAuthWith("ai:chat");
    const parsed = askSchema.parse(input);

    await assertWithinUsage(context.organization.id, "chat_messages");

    const account = await resolveActiveAccount(context);
    if (!account) throw errors.notFound("Connect a Google Ads account first.");

    const turn = await runAgentTurn({
      organizationId: context.organization.id,
      accountId: account.id,
      userId: context.user.id,
      threadId: parsed.threadId ?? null,
      message: parsed.message,
    });

    await recordUsage(context.organization.id, "chat_messages", 1);
    revalidatePath("/ai");

    return {
      ok: true,
      threadId: turn.threadId,
      answer: turn.answer,
      toolsUsed: turn.toolsUsed,
      usedModel: turn.usedModel,
    };
  } catch (error) {
    log.error("agent turn failed", { error });
    return { ok: false, message: toUserMessage(error) };
  }
}

export async function deleteThreadAction(threadId: string): Promise<void> {
  const context = await requireAuthWith("ai:chat");
  await deleteThread(context.organization.id, context.user.id, threadId);
  revalidatePath("/ai");
}
