import type { ReactNode } from "react";
import { Bot, GitBranch, Hammer, Loader2, Terminal, User } from "lucide-react";
import { LoadingPanel } from "@/components/status/LoadingPanel";
import { ToolCallItem } from "@/components/tools/ToolCallItem";
import type { PiMessage, PiToolCall } from "@/shared/pi/types";

interface MessageListProps {
  messages: PiMessage[];
  isConnecting?: boolean;
  isRefreshing?: boolean;
  onSelectTool?: (tool: PiToolCall) => void;
}

export function MessageList({ messages, isConnecting = false, isRefreshing = false, onSelectTool }: MessageListProps) {
  const showEmptyState = !messages.length && !isConnecting;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="border border-border bg-surface/70 p-5 shadow-[inset_2px_0_0_var(--primary)] sm:p-6">
        <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-primary">Pi workbench</div>
        <h1 className="font-serif text-3xl font-semibold italic tracking-tight sm:text-4xl">Build with pi, not around it.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          面向 pi 的 coding agent 工作台：sessions、tools、models、thinking、compaction、extensions 全部可见，不是普通聊天壳。
        </p>
      </div>

      {isConnecting ? <LoadingPanel /> : null}

      {isRefreshing && messages.length ? (
        <div className="inline-flex w-fit items-center gap-2 rounded-sm border border-border bg-surface/80 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <Loader2 size={12} className="animate-spin text-primary" /> refreshing pi state
        </div>
      ) : null}

      {showEmptyState ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <EmptyCard icon={<Terminal size={16} />} title="Start with prompt" text="让 pi inspect/edit/test 当前项目，所有 tool call 会在流中展开。" />
          <EmptyCard icon={<Hammer size={16} />} title="Tools visible" text="bash/read/write/edit/grep/find/ls 结果进入中央流和 Inspector。" />
          <EmptyCard icon={<GitBranch size={16} />} title="Session first" text="后续 fork/clone/tree 会围绕 pi JSONL session 展开。" />
        </section>
      ) : null}

      {messages.map((message) => (
        <article key={message.id} className="flex gap-3">
          <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface/75 text-muted-foreground">
            {message.role === "user" ? <User size={16} /> : <Bot size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{message.role === "user" ? "You" : "pi"}</span>
              <span>{message.createdAt}</span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6">
              {message.content || <span className="text-muted-foreground">pi thinking / tool routing...</span>}
            </div>
            {message.tools?.length ? (
              <div className="mt-4 space-y-2 rounded-md border border-border bg-surface/70 p-2">
                {message.tools.map((tool) => (
                  <ToolCallItem key={tool.id} tool={tool} onSelect={onSelectTool} />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

interface EmptyCardProps {
  icon: ReactNode;
  title: string;
  text: string;
}

function EmptyCard({ icon, title, text }: EmptyCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface/65 p-4 shadow-[inset_2px_0_0_var(--accent)]">
      <div className="mb-3 flex size-8 items-center justify-center rounded-sm border border-border bg-background text-primary">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{text}</div>
    </div>
  );
}
