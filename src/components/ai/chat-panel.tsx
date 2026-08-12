"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";

import { askAgentAction } from "@/app/(dashboard)/ai/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The agent conversation.
 *
 * Answers are produced server-side from the database, so the transcript here is a
 * rendering concern only — the client never sees, sends or invents a metric.
 */

export type ChatMessageView = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
};

const SUGGESTIONS = [
  "What should I change today?",
  "Why did my ROAS drop?",
  "Which keywords make the most money?",
  "Show me wasted spend",
  "What happened this week?",
];

export function ChatPanel({
  threadId,
  initialMessages,
  accountName,
  isDemo,
}: {
  threadId: string | null;
  initialMessages: ChatMessageView[];
  accountName: string;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [activeThread, setActiveThread] = useState<string | null>(threadId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function send(text: string) {
    const message = text.trim();
    if (message.length < 2 || pending) return;

    setDraft("");
    setError(null);
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "USER", content: message },
    ]);

    startTransition(async () => {
      const result = await askAgentAction({ message, threadId: activeThread });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setActiveThread(result.threadId);
      setMessages((current) => [
        ...current,
        { id: `answer-${Date.now()}`, role: "ASSISTANT", content: result.answer },
      ]);

      // Refresh so the thread list picks up the new conversation.
      router.refresh();
    });
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {empty ? (
          <div className="mx-auto max-w-xl py-10 text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <h2 className="mt-3 text-[16px] font-semibold">Ask about {accountName}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              Every number in an answer is read from your synced Google Ads data. When the data
              isn&rsquo;t there, the agent says so instead of guessing.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-border-strong hover:bg-secondary/60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {pending ? (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Reading your account data…
              </div>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-negative/20 bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-card px-4 py-3 sm:px-6">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            placeholder={`Ask about ${accountName}…`}
            aria-label="Message the AI agent"
            className="max-h-40 min-h-9 resize-none py-2"
          />
          <Button type="submit" size="icon" disabled={pending || draft.trim().length < 2}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            <span className="sr-only">Send</span>
          </Button>
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted-foreground">
          {isDemo
            ? "Demo account — answers describe generated data."
            : "Answers come from your synced data, which can be a few hours behind Google Ads."}
        </p>
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessageView }) {
  const isUser = message.role === "USER";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-6",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-foreground",
        )}
      >
        {message.content.split("\n").map((line, index) =>
          line.trim().length === 0 ? (
            <span key={index} className="block h-2" />
          ) : (
            <p key={index} className={cn(index > 0 && "mt-1.5")}>
              {line}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
