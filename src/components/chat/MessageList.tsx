import { Bot, User } from "lucide-react";
import { ToolCallItem } from "@/components/tools/ToolCallItem";
import type { PiMessage, PiToolCall } from "@/shared/pi/types";

interface MessageListProps {
  messages: PiMessage[];
  onSelectTool?: (tool: PiToolCall) => void;
}

export function MessageList({ messages, onSelectTool }: MessageListProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-auto px-6 py-8">
      <div className="border border-border bg-surface/70 p-6 shadow-[inset_2px_0_0_var(--primary)]">
        <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-primary">Pi workbench</div>
        <h1 className="font-serif text-4xl font-semibold italic tracking-tight">Build with pi, not around it.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          PiClient 抽象已接入 UI。Tauri 环境使用真实 `pi --mode rpc`，浏览器开发环境回退 mock client。
        </p>
      </div>

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
              {message.content || <span className="text-muted-foreground">Thinking...</span>}
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
