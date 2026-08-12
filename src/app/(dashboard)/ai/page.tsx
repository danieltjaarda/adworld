import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";

import { ThreadList } from "@/app/(dashboard)/ai/thread-list";
import { ChatPanel, type ChatMessageView } from "@/components/ai/chat-panel";
import { Button } from "@/components/ui/button";
import { getThreadMessages, listThreads } from "@/lib/ai/chat";
import { formatRelativeTime } from "@/lib/analytics/format";
import { loadPageContext, type SearchParams } from "@/lib/dashboard/page-context";

export const metadata: Metadata = { title: "AI agent" };

export default async function AIPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { auth, account } = await loadPageContext(params);

  const requestedThread = typeof params.thread === "string" ? params.thread : null;

  const threads = await listThreads(auth.organization.id, auth.user.id, account.id);

  const active = requestedThread
    ? await getThreadMessages(auth.organization.id, auth.user.id, requestedThread)
    : null;

  const messages: ChatMessageView[] =
    active?.messages.map((message) => ({
      id: message.id,
      role: message.role === "USER" ? "USER" : "ASSISTANT",
      content: message.content,
    })) ?? [];

  return (
    <div className="grid h-[calc(100dvh-8.5rem)] min-h-[520px] gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col rounded-xl border border-border bg-card shadow-card lg:flex">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Conversations</h2>
          <Button asChild variant="ghost" size="icon-sm" aria-label="New conversation">
            <Link href="/ai">
              <MessageSquarePlus className="size-4" />
            </Link>
          </Button>
        </div>

        <ThreadList
          threads={threads.map((thread) => ({
            id: thread.id,
            title: thread.title ?? "Untitled",
            updatedAt: formatRelativeTime(thread.updatedAt),
          }))}
          activeId={active?.thread.id ?? null}
        />
      </aside>

      <section className="min-h-0 overflow-hidden rounded-xl border border-border bg-canvas shadow-card">
        {/* Keyed so switching conversations remounts with a clean transcript. */}
        <ChatPanel
          key={active?.thread.id ?? "new"}
          threadId={active?.thread.id ?? null}
          initialMessages={messages}
          accountName={account.descriptiveName}
          isDemo={account.isDemo}
        />
      </section>
    </div>
  );
}
