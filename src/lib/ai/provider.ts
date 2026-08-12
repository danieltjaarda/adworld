import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { features, getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

/**
 * LLM abstraction.
 *
 * The product talks to this interface only, so swapping OpenAI for any other
 * OpenAI-compatible endpoint (Azure, OpenRouter, a local model) is an env change. When
 * no key is configured, a deterministic heuristic provider takes over so the whole
 * product — including classification and summaries — still works offline.
 */

const log = createLogger("ai.provider");

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type CompletionResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
  model: string;
};

export type StructuredRequest<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Deterministic result used when no model is configured, and as the graceful
   * degradation path when a live call fails. Every call site must be able to answer
   * without an LLM — that is what keeps demo mode honest and outages survivable.
   */
  fallback: () => T;
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly isLive: boolean;
  /** Structured generation validated against a Zod schema. */
  structured<T>(request: StructuredRequest<T>): Promise<{ data: T; usage: CompletionResult["usage"] }>;
  chat(request: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<CompletionResult>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly isLive = true;
  readonly model: string;
  private readonly client: OpenAI;

  constructor() {
    const env = getEnv();
    this.model = env.OPENAI_MODEL;
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
      maxRetries: 2,
      timeout: 60_000,
    });
  }

  async structured<T>(
    request: StructuredRequest<T>,
  ): Promise<{ data: T; usage: CompletionResult["usage"] }> {
    const jsonSchema = z.toJSONSchema(request.schema, { io: "output" });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2000,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: false,
            schema: jsonSchema as Record<string, unknown>,
          },
        },
      });

      const content = response.choices[0]?.message?.content ?? "";
      const parsed = request.schema.safeParse(safeJsonParse(content));

      if (!parsed.success) {
        log.error("model returned data that failed schema validation", {
          schema: request.schemaName,
          issues: parsed.error.issues.slice(0, 5),
        });
        throw new AppError(
          "AI_PROVIDER",
          "The AI returned an unexpected response. Nothing was changed.",
          { internalMessage: `schema ${request.schemaName} validation failed` },
        );
      }

      return {
        data: parsed.data,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("openai structured call failed", { error, schema: request.schemaName });
      throw new AppError("AI_PROVIDER", "The AI service is unavailable right now.", { cause: error });
    }
  }

  async chat(request: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 1200,
        messages: request.messages.map((message) => {
          if (message.role === "tool") {
            return {
              role: "tool" as const,
              content: message.content,
              tool_call_id: message.toolCallId ?? "",
            };
          }
          return { role: message.role, content: message.content } as
            | { role: "system"; content: string }
            | { role: "user"; content: string }
            | { role: "assistant"; content: string };
        }),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function" as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: "auto" as const,
            }
          : {}),
      });

      const choice = response.choices[0]?.message;

      return {
        text: choice?.content ?? "",
        toolCalls: (choice?.tool_calls ?? [])
          .filter((call): call is typeof call & { function: { name: string; arguments: string } } =>
            "function" in call,
          )
          .map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        model: this.model,
      };
    } catch (error) {
      log.error("openai chat call failed", { error });
      throw new AppError("AI_PROVIDER", "The AI assistant is unavailable right now.", {
        cause: error,
      });
    }
  }
}

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // Some models wrap JSON in prose or fences; recover the outermost object.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic provider (no API key configured)
// ---------------------------------------------------------------------------

class DeterministicProvider implements AIProvider {
  readonly name = "deterministic";
  readonly model = "rule-engine";
  readonly isLive = false;

  async structured<T>(
    request: StructuredRequest<T>,
  ): Promise<{ data: T; usage: CompletionResult["usage"] }> {
    return { data: request.fallback(), usage: { promptTokens: 0, completionTokens: 0 } };
  }

  async chat(): Promise<CompletionResult> {
    return {
      text: "",
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      model: this.model,
    };
  }
}

let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = features.ai ? new OpenAIProvider() : new DeterministicProvider();
  log.info("ai provider selected", { provider: cachedProvider.name, model: cachedProvider.model });
  return cachedProvider;
}

/**
 * Structured generation that degrades instead of failing: a model outage or a schema
 * violation falls back to the deterministic result rather than breaking the page.
 */
export async function structuredWithFallback<T>(request: StructuredRequest<T>): Promise<{
  data: T;
  usedModel: boolean;
}> {
  const provider = getAIProvider();
  if (!provider.isLive) return { data: request.fallback(), usedModel: false };

  try {
    const result = await provider.structured(request);
    return { data: result.data, usedModel: true };
  } catch (error) {
    log.warn("falling back to deterministic output", { schema: request.schemaName, error });
    return { data: request.fallback(), usedModel: false };
  }
}

/** Test helper. */
export function resetAIProvider(): void {
  cachedProvider = null;
}
