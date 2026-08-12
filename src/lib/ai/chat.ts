import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getAIProvider, type ChatMessage } from "@/lib/ai/provider";
import { executeTool, toolDefinitions, type ToolContext } from "@/lib/ai/tools";
import { formatDate } from "@/lib/analytics/format";
import { todayInTimeZone } from "@/lib/analytics/date-range";
import { getAccountSettings } from "@/lib/analytics/queries";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { truncate } from "@/lib/utils";

/**
 * The agent loop.
 *
 * The model may only read, and only through the tool registry. It never receives the
 * database, never receives credentials, and cannot change anything: the worst a
 * compromised prompt can do is ask for data the user can already see on the dashboard.
 */

const log = createLogger("ai.chat");

const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 20;

export type AgentTurn = {
  threadId: string;
  answer: string;
  toolsUsed: string[];
  usedModel: boolean;
};

export async function runAgentTurn(input: {
  organizationId: string;
  accountId: string;
  userId: string;
  threadId?: string | null;
  message: string;
}): Promise<AgentTurn> {
  const account = await prisma.googleAdsAccount.findFirst({
    where: { id: input.accountId, organizationId: input.organizationId },
    select: {
      id: true,
      descriptiveName: true,
      currencyCode: true,
      timeZone: true,
      isDemo: true,
      lastSyncedAt: true,
    },
  });
  if (!account) throw new AppError("NOT_FOUND", "That account is not available.");

  const thread = await resolveThread(input, account.descriptiveName);
  const history = await loadHistory(thread.id);

  await prisma.chatMessage.create({
    data: { threadId: thread.id, role: "USER", content: input.message },
  });

  const context: ToolContext = {
    organizationId: input.organizationId,
    accountId: account.id,
    currency: account.currencyCode,
    timeZone: account.timeZone,
  };

  const settings = await getAccountSettings(context);
  const systemPrompt = buildSystemPrompt({
    accountName: account.descriptiveName,
    currency: account.currencyCode,
    timeZone: account.timeZone,
    isDemo: account.isDemo,
    lastSyncedAt: account.lastSyncedAt,
    mode: settings.mode,
    targetRoas: settings.targetRoas,
    targetCpa: settings.targetCpa,
  });

  const provider = getAIProvider();

  if (!provider.isLive) {
    const answer = await deterministicAnswer(context, input.message);
    await persistAssistant(thread.id, answer.text, answer.toolsUsed, null);
    return { threadId: thread.id, answer: answer.text, toolsUsed: answer.toolsUsed, usedModel: false };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: input.message },
  ];

  const toolsUsed: string[] = [];
  let usage = { promptTokens: 0, completionTokens: 0 };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const lastRound = round === MAX_TOOL_ROUNDS;

      const completion = await provider.chat({
        messages,
        // On the final round the model must answer with what it already has.
        tools: lastRound ? undefined : toolDefinitions(),
        temperature: 0.3,
        maxTokens: 1200,
      });

      usage = {
        promptTokens: usage.promptTokens + completion.usage.promptTokens,
        completionTokens: usage.completionTokens + completion.usage.completionTokens,
      };

      if (completion.toolCalls.length === 0) {
        const answer =
          completion.text.trim() ||
          "I could not find enough data in this account to answer that.";
        await persistAssistant(thread.id, answer, toolsUsed, usage);
        return { threadId: thread.id, answer, toolsUsed, usedModel: true };
      }

      messages.push({
        role: "assistant",
        content: completion.text || "",
      });

      for (const call of completion.toolCalls) {
        const execution = await executeTool(context, call.name, call.arguments);
        toolsUsed.push(call.name);

        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(execution.result),
        });
      }
    }

    const fallback =
      "I gathered the data but could not finish the analysis. Try asking about one thing at a time.";
    await persistAssistant(thread.id, fallback, toolsUsed, usage);
    return { threadId: thread.id, answer: fallback, toolsUsed, usedModel: true };
  } catch (error) {
    log.error("agent turn failed", { error, threadId: thread.id });

    // A model outage should still produce a useful, factual answer.
    const answer = await deterministicAnswer(context, input.message);
    await persistAssistant(thread.id, answer.text, answer.toolsUsed, null);
    return { threadId: thread.id, answer: answer.text, toolsUsed: answer.toolsUsed, usedModel: false };
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(input: {
  accountName: string;
  currency: string;
  timeZone: string;
  isDemo: boolean;
  lastSyncedAt: Date | null;
  mode: string;
  targetRoas: number | null;
  targetCpa: number | null;
}): string {
  const today = todayInTimeZone(input.timeZone);

  return `You are the Google Ads analyst inside AdLeverage. You answer questions about one specific advertising account using tools that read that account's data.

Account: ${input.accountName}
Currency: ${input.currency}
Time zone: ${input.timeZone}
Today: ${today}
Data last synchronized: ${input.lastSyncedAt ? formatDate(input.lastSyncedAt) : "never"}
Optimization mode: ${input.mode}
Target ROAS: ${input.targetRoas ?? "not set"}
Target CPA: ${input.targetCpa ?? "not set"}${
    input.isDemo
      ? "\n\nThis is a demo account with generated data. Say so if the user seems to think it is real."
      : ""
  }

How you work:
- Every number you state must come from a tool result in this conversation. If you have not fetched it, fetch it. Never estimate, never recall a figure from earlier training, never fill a gap with a plausible value.
- If the tools return no data or too little data, say "There is not enough data to answer that" and explain what is missing.
- Call tools before answering anything factual. Prefer one or two well-chosen calls over many.
- You cannot change anything in Google Ads. When a change is warranted, describe it and point the user to the Recommendations page, where changes are prepared with safety limits applied.

How you write:
- Lead with the answer in one sentence, then the supporting numbers.
- Plain English for a business owner. No jargon unless the user uses it first. No emoji, no bullet-point dumps of every metric.
- Be specific: name the campaign, keyword or search term, and give the figure that matters.
- Short paragraphs. Use a list only when comparing three or more items.
- Never invent causation. If spend rose and conversions fell, say what the data shows and what you would check next.`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function resolveThread(
  input: { organizationId: string; accountId: string; userId: string; threadId?: string | null; message: string },
  accountName: string,
) {
  if (input.threadId) {
    const existing = await prisma.chatThread.findFirst({
      where: {
        id: input.threadId,
        organizationId: input.organizationId,
        userId: input.userId,
      },
      select: { id: true },
    });
    if (existing) return existing;
  }

  return prisma.chatThread.create({
    data: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      userId: input.userId,
      title: truncate(input.message, 60) || `${accountName} analysis`,
    },
    select: { id: true },
  });
}

async function loadHistory(threadId: string): Promise<ChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { threadId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  return rows
    .reverse()
    .map((row) => ({
      role: row.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: row.content,
    }));
}

async function persistAssistant(
  threadId: string,
  content: string,
  toolsUsed: string[],
  usage: { promptTokens: number; completionTokens: number } | null,
): Promise<void> {
  await prisma.chatMessage.create({
    data: {
      threadId,
      role: "ASSISTANT",
      content,
      toolCalls: toolsUsed.length > 0 ? ({ tools: toolsUsed } as Prisma.InputJsonValue) : undefined,
      tokensIn: usage?.promptTokens ?? null,
      tokensOut: usage?.completionTokens ?? null,
    },
  });

  await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Deterministic answers (no model configured, or the model is down)
// ---------------------------------------------------------------------------

type Intent = {
  match: RegExp;
  tool: string;
  args: Record<string, unknown>;
  intro: string;
};

/**
 * Not a language model — a keyword router over the same tools. It answers the handful
 * of questions people actually ask, with real numbers, so demo mode and outages still
 * produce something honest instead of an error.
 */
const INTENTS: Intent[] = [
  {
    match: /waste|wasted|losing money|throwing away|negative/i,
    tool: "getSearchTerms",
    args: { limit: 8, onlyWithoutConversions: true },
    intro: "Here are the search terms that spent the most without converting.",
  },
  {
    match: /search term|query|queries/i,
    tool: "getSearchTerms",
    args: { limit: 10 },
    intro: "Here are the search terms with the most spend.",
  },
  {
    match: /budget|scale|spend more|increase/i,
    tool: "getCampaignPerformance",
    args: { period: "last_30", limit: 10 },
    intro: "Here is how each campaign is performing, including which ones are capped by budget.",
  },
  {
    match: /keyword|bid/i,
    tool: "getKeywordPerformance",
    args: { period: "last_30", limit: 10 },
    intro: "Here are your keywords by spend.",
  },
  {
    match: /ad copy|headline|creative|ads?\b/i,
    tool: "getAdPerformance",
    args: { period: "last_30", limit: 8 },
    intro: "Here is how your ads are performing.",
  },
  {
    match: /wrong|drop|dropped|down|problem|alert|anomal/i,
    tool: "getAnomalies",
    args: {},
    intro: "Here is what the anomaly scanner has flagged.",
  },
  {
    match: /what should i (do|change)|recommend|today|next/i,
    tool: "getRecommendations",
    args: { limit: 8 },
    intro: "Here is what the optimizer suggests, highest priority first.",
  },
  {
    match: /device|location|time of day|hour|day of week/i,
    tool: "getSegmentPerformance",
    args: { period: "last_30", segment: "DEVICE" },
    intro: "Here is the breakdown by device.",
  },
];

async function deterministicAnswer(
  context: ToolContext,
  message: string,
): Promise<{ text: string; toolsUsed: string[] }> {
  const intent = INTENTS.find((candidate) => candidate.match.test(message));
  const chosen = intent ?? {
    tool: "getAccountOverview",
    args: { period: "last_30" },
    intro: "Here is how the account performed over the last 30 days.",
  };

  const execution = await executeTool(context, chosen.tool, JSON.stringify(chosen.args));

  if (!execution.ok) {
    return {
      text: "I could not load that data right now. Please try again in a moment.",
      toolsUsed: [chosen.tool],
    };
  }

  const body = renderPlainResult(execution.result);

  return {
    text: `${chosen.intro}\n\n${body}\n\nThe AI assistant is running without a language model, so this is a direct data answer. Configure an AI provider for full conversational analysis.`,
    toolsUsed: [chosen.tool],
  };
}

/** Renders a tool result as readable lines rather than raw JSON. */
function renderPlainResult(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);

  const record = result as Record<string, unknown>;
  const listKey = Object.keys(record).find((key) => Array.isArray(record[key]));

  if (!listKey) return formatObject(record);

  const rows = record[listKey] as unknown[];
  if (rows.length === 0) return "No matching data in this period.";

  return rows
    .slice(0, 10)
    .map((row, index) => `${index + 1}. ${formatObject(row as Record<string, unknown>)}`)
    .join("\n");
}

function formatObject(record: Record<string, unknown>): string {
  return Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .map(([key, value]) => `${humanize(key)}: ${String(value)}`)
    .join(" · ");
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Thread management
// ---------------------------------------------------------------------------

export async function listThreads(organizationId: string, userId: string, accountId: string) {
  return prisma.chatThread.findMany({
    where: { organizationId, userId, accountId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, updatedAt: true },
  });
}

export async function getThreadMessages(
  organizationId: string,
  userId: string,
  threadId: string,
) {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, organizationId, userId },
    select: { id: true, title: true },
  });
  if (!thread) return null;

  const messages = await prisma.chatMessage.findMany({
    where: { threadId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return { thread, messages };
}

export async function deleteThread(
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<void> {
  await prisma.chatThread.deleteMany({ where: { id: threadId, organizationId, userId } });
}
