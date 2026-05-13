import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, Brain, Check, ChevronRight, Copy, FileText, ImageIcon, Loader2, Terminal } from "lucide-react";
import { LoadingPanel } from "@/components/status/LoadingPanel";
import { ToolCallItem } from "@/components/tools/ToolCallItem";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiMessage, PiToolCall } from "@/shared/pi/types";

interface MessageListProps {
  messages: PiMessage[];
  isConnecting?: boolean;
  isRefreshing?: boolean;
  isSwitchingSession?: boolean;
  isRunning?: boolean;
  onSelectTool?: (tool: PiToolCall) => void;
}

interface TimelineItem {
  id: string;
  role: PiMessage["role"];
  author: string;
  time: string;
  summary: string;
}

type RenderItem =
  | { type: "message"; message: PiMessage }
  | { type: "activityGroup"; id: string; tools: PiToolCall[]; messages: PiMessage[] };

export function MessageList({ messages, isConnecting = false, isRefreshing = false, isSwitchingSession = false, isRunning = false, onSelectTool }: MessageListProps) {
  const { t } = useI18n();
  const showEmptyState = !messages.length && !isConnecting;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const shouldAutoScrollRef = useRef(true);
  const timelineItems = useMemo(() => buildTimelineItems(messages, t), [messages, t]);
  const activeAssistantId = isRunning ? findLastAssistantId(messages) : null;
  const renderItems = useMemo(() => buildRenderItems(messages, activeAssistantId), [messages, activeAssistantId]);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(timelineItems[0]?.id ?? null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const streamSignature = useMemo(() => buildStreamSignature(messages), [messages]);

  useEffect(() => {
    if (!timelineItems.length) {
      setActiveTimelineId(null);
      return;
    }
    setActiveTimelineId((current) => (current && timelineItems.some((item) => item.id === current) ? current : timelineItems[0].id));
  }, [timelineItems]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || isConnecting || isSwitchingSession) return;
    if (isPromptStart(messages, activeAssistantId)) shouldAutoScrollRef.current = true;
    if (!shouldAutoScrollRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    setShowScrollToBottom(false);
    updateActiveTimelineItem();
  }, [streamSignature, isConnecting, isSwitchingSession, messages, activeAssistantId]);

  function updateActiveTimelineItem() {
    const container = scrollRef.current;
    if (!container) return;
    const atBottom = isScrollAtBottom(container);
    shouldAutoScrollRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
    if (!timelineItems.length) return;
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + containerRect.height * 0.32;
    let nearestId = timelineItems[0].id;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const item of timelineItems) {
      const node = messageRefs.current.get(item.id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const distance = Math.abs(rect.top - targetY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = item.id;
      }
    }

    setActiveTimelineId(nearestId);
  }

  function scrollToBottom() {
    const container = scrollRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollToBottom(false);
  }

  function scrollToMessage(id: string) {
    const container = scrollRef.current;
    const node = messageRefs.current.get(id);
    if (!container || !node) return;

    setActiveTimelineId(id);
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const safeBottom = 180;
    const targetTop = container.scrollTop + nodeRect.top - containerRect.top - container.clientHeight * 0.28;
    const maxTop = Math.max(container.scrollHeight - container.clientHeight + safeBottom, 0);
    container.scrollTo({ top: Math.min(Math.max(targetTop, 0), maxTop), behavior: "auto" });
  }

  return (
    <div className="relative z-10 min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="message-list-scrollbar h-full overflow-y-auto overflow-x-hidden px-3 py-4 pr-9 sm:px-5 sm:py-6 sm:pr-12"
        aria-label={t("message.listLabel")}
        onScroll={updateActiveTimelineItem}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-36">
          {isConnecting || isSwitchingSession ? <LoadingPanel label={isSwitchingSession ? t("loading.session") : undefined} /> : null}

          {isRefreshing && messages.length ? (
            <div className="inline-flex w-fit items-center gap-2 border border-border bg-surface/85 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
              <Loader2 size={11} className="animate-spin text-primary" /> {t("message.refreshing")}
            </div>
          ) : null}

          {showEmptyState ? <div className="min-h-[28vh]" /> : null}

          <div className="flex flex-col gap-4">
            {renderItems.map((item) => {
              if (item.type === "message") {
                const isActiveAssistant = item.message.id === activeAssistantId;
                if (!isActiveAssistant && isHiddenAssistantMessage(item.message)) return null;
                return (
                  <div
                    key={item.message.id}
                    ref={(node) => {
                      if (node) messageRefs.current.set(item.message.id, node);
                      else messageRefs.current.delete(item.message.id);
                    }}
                    className="scroll-mt-16"
                  >
                    <MessageBubble message={item.message} onSelectTool={onSelectTool} isActive={isActiveAssistant} />
                  </div>
                );
              }

              return (
                <div key={item.id} className="scroll-mt-16">
                  <ActivityGroup tools={item.tools} messages={item.messages} onSelectTool={onSelectTool} live={isRunning} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showScrollToBottom ? (
        <button
          type="button"
          className="absolute bottom-5 right-10 z-20 flex size-9 cursor-pointer items-center justify-center border border-border bg-surface/90 text-muted-foreground shadow-[0_10px_30px_rgb(44_54_70/0.14)] backdrop-blur transition hover:border-primary/30 hover:bg-muted hover:text-primary sm:right-14"
          aria-label="返回底部"
          title="返回底部"
          onClick={scrollToBottom}
        >
          <ArrowDown size={16} />
        </button>
      ) : null}

      {timelineItems.length ? <MessageTimeline items={timelineItems} activeId={activeTimelineId} onJump={scrollToMessage} /> : null}
    </div>
  );
}

function MessageBubble({ message, onSelectTool, isActive = false }: { message: PiMessage; onSelectTool?: (tool: PiToolCall) => void; isActive?: boolean }) {
  const isUser = message.role === "user";
  const displayContent = message.role === "assistant" ? stripToolMarkers(message.content) : message.content;
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    const text = getCopyText(message, displayContent);
    if (!text) return;
    await copyTextToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (message.role === "system") return <SystemMessage message={message} />;
  if (message.role === "branchSummary") return <SummaryMessage kind="branch" message={message} />;
  if (message.role === "compactionSummary") return <SummaryMessage kind="compaction" message={message} />;
  if (message.role === "custom") return <CustomMessage message={message} />;
  if (message.role === "bashExecution") return <BashExecutionMessage message={message} />;
  if (message.role === "toolResult") return <ToolResultMessage message={message} onSelectTool={onSelectTool} />;

  return (
    <article className={cn("flex w-full gap-2.5", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0", isUser ? "flex max-w-[min(34rem,86%)] flex-col items-end" : "max-w-[min(44rem,94%)] flex-1")}>
        {isUser ? (
          <UserContent message={message} />
        ) : (
          <AssistantContent message={message} content={displayContent} createdAt={message.createdAt} isActive={isActive} onSelectTool={onSelectTool} />
        )}
        {getCopyText(message, displayContent) ? <CopyAction align={isUser ? "right" : "left"} copied={copied} onCopy={copyMessage} /> : null}
      </div>
    </article>
  );
}

function ActivityGroup({ tools, messages, onSelectTool, className, live = false }: { tools: PiToolCall[]; messages: PiMessage[]; onSelectTool?: (tool: PiToolCall) => void; className?: string; live?: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const summaryItems = summarizeActivity(tools, messages);
  const count = tools.length + messages.length;
  useEffect(() => {
    if (live) setExpanded(true);
    else setExpanded(false);
  }, [live]);
  return (
    <section className={cn("w-full max-w-[min(44rem,96%)]", className)}>
      <button
        type="button"
        className="cursor-pointer group flex w-full items-center gap-1.5 border border-border/70 bg-surface/80 px-2.5 py-1.5 text-left text-[11px] leading-4 text-muted-foreground shadow-[0_8px_24px_rgb(44_54_70/0.04)] transition hover:border-primary/25 hover:bg-muted/50"
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight className={cn("shrink-0 text-muted-foreground transition", expanded && "rotate-90")} size={12} />
        <span className="shrink-0 text-[10px] font-medium text-foreground">活动</span>
        <span className="shrink-0 border border-border/70 bg-background/75 px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">{count}</span>
        {summaryItems.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
            {summaryItems.map((item, index) => (
              <span key={`${index}:${item}`} className="max-w-full truncate border border-border/60 bg-background/60 px-1.5 py-0 font-mono text-[10px] leading-4 text-muted-foreground/95">
                {item}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-1 border border-border/70 bg-surface/50 p-1.5 font-mono text-[11px] leading-5 shadow-[0_8px_24px_rgb(44_54_70/0.03)]">
          {messages.map((message) => (
            <GroupedMessage key={message.id} message={message} live={live} />
          ))}
          {tools.map((tool) => (
            <ToolCallItem key={tool.id} tool={tool} onSelect={onSelectTool} defaultExpanded={live} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GroupedMessage({ message, live = false }: { message: PiMessage; live?: boolean }) {
  if (message.role === "assistant") {
    return (
      <div className="border border-border/70 bg-background/60 font-mono text-[11px] leading-5 text-muted-foreground">
        <AssistantBlocks message={message} fallback={message.content} live={live} />
      </div>
    );
  }
  return <MessageBubble message={message} isActive={live} />;
}

function summarizeActivity(tools: PiToolCall[], messages: PiMessage[]): string[] {
  return [...summarizeTools(tools), ...summarizeGroupedMessages(messages)];
}

function compactThinkingPreview(text: string): string {
  const compact = text.replace(/[#*_`>\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (!compact) return "reasoning trace";
  return compact.length > 90 ? `${compact.slice(0, 87)}…` : compact;
}

function summarizeTools(tools: PiToolCall[]): string[] {
  const visible = tools.slice(-3).map((tool) => {
    const target = compactToolTarget(tool);
    return target ? `${getToolActivityLabel(tool.name)} ${target}` : getToolActivityLabel(tool.name);
  });
  if (tools.length > visible.length) visible.unshift(`工具×${tools.length - visible.length}`);
  return visible;
}

function summarizeGroupedMessages(messages: PiMessage[]): string[] {
  const thinkingCount = messages.filter((message) => message.contentBlocks?.some((block) => block.type === "thinking" && block.thinking.trim())).length;
  const otherCount = messages.length - thinkingCount;
  return [thinkingCount ? formatActivityCount("思考", thinkingCount) : "", otherCount ? formatActivityCount("消息", otherCount) : ""].filter(Boolean);
}

function formatActivityCount(label: string, count: number): string {
  return count > 1 ? `${label}×${count}` : label;
}

function getToolActivityLabel(name: string): string {
  const labels: Record<string, string> = {
    read: "读取",
    write: "写入",
    edit: "修改",
    bash: "命令",
    grep: "搜索",
    find: "查找",
    ls: "列表",
    tool: "工具",
  };
  return labels[name] ?? name;
}

function compactToolTarget(tool: PiToolCall): string {
  const target = getToolArgString(tool, "path") || getToolArgString(tool, "file_path") || getToolArgString(tool, "filePath") || getToolArgString(tool, "command") || (tool.target && tool.target !== tool.name && tool.target !== "unknown" ? tool.target : "");
  if (!target) return "";
  const normalized = target.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const compact = parts.length > 2 ? parts.slice(-2).join("/") : normalized;
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}

function getToolArgString(tool: PiToolCall, key: string): string {
  const value = tool.args?.[key];
  return typeof value === "string" ? value : "";
}

function CopyAction({ align, copied, onCopy }: { align: "left" | "right"; copied: boolean; onCopy: () => Promise<void> | void }) {
  const { t } = useI18n();
  return (
    <div className={cn("mt-1 flex px-1", align === "right" ? "justify-end" : "justify-start")}>
      <button
        type="button"
        className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary"
        aria-label={copied ? t("message.copied") : t("message.copy")}
        title={copied ? t("message.copied") : t("message.copy")}
        onClick={() => void onCopy()}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

function UserContent({ message }: { message: PiMessage }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-1 px-1 text-right font-mono text-[10px] text-muted-foreground">{message.createdAt}</div>
      <div className="border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-5 text-foreground shadow-[0_8px_24px_rgb(44_54_70/0.045)]">
        <div className="whitespace-pre-wrap break-words">{message.content || <span className="text-muted-foreground">{t("message.thinking")}</span>}</div>
      </div>
    </div>
  );
}

function AssistantContent({ message, content, createdAt, isActive, onSelectTool }: { message: PiMessage; content: string; createdAt: string; isActive: boolean; onSelectTool?: (tool: PiToolCall) => void }) {
  const hasContent = Boolean(content.trim());
  const renderBlocks = shouldRenderAssistantBlocks(message);
  const hasTools = Boolean(message.tools?.length);
  const showWorking = isActive && !hasContent && !renderBlocks && !hasTools;

  return (
    <div>
      <div className="mb-1 px-1 font-mono text-[10px] text-muted-foreground">{createdAt}</div>
      <div className="overflow-hidden border border-border bg-surface/82 text-foreground shadow-[0_10px_30px_rgb(44_54_70/0.055)]">
        <div className="space-y-3 px-3.5 py-3 text-[13px] leading-5">
          {showWorking ? <WorkingBlock /> : renderBlocks ? <AssistantBlocks message={message} fallback={content} live={isActive} /> : hasContent ? <MarkdownContent content={content} /> : null}
          {message.tools?.length ? <ActivityGroup tools={message.tools} messages={[]} onSelectTool={onSelectTool} live={isActive} /> : null}
          <AssistantStopState message={message} />
          {isActive ? <LiveResponseTail /> : null}
        </div>
      </div>
    </div>
  );
}

function SystemMessage({ message }: { message: PiMessage }) {
  const { t } = useI18n();
  return (
    <article className="mx-auto max-w-[min(34rem,92%)] border border-border bg-muted/50 px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
      {message.content || <span>{t("message.thinking")}</span>}
    </article>
  );
}

function AssistantBlocks({ message, fallback, live = false }: { message: PiMessage; fallback: string; live?: boolean }) {
  const blocks = message.contentBlocks?.length ? message.contentBlocks : fallback ? [{ type: "text" as const, text: fallback }] : [];
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "text") return block.text.trim() ? <MarkdownContent key={index} content={stripToolMarkers(block.text)} /> : null;
        if (block.type === "thinking") return <ThinkingBlock key={index} block={block} live={live} />;
        if (block.type === "image") return <ImageBlock key={index} block={block} />;
        if (block.type === "toolCall") return null;
        return <UnknownBlock key={index} label={block.label} value={block.value} />;
      })}
    </>
  );
}

function WorkingBlock() {
  return (
    <div className="flex items-center gap-2 border border-border bg-background/60 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
      <Loader2 size={13} className="animate-spin text-primary" />
      <span>working…</span>
    </div>
  );
}

function LiveResponseTail() {
  return (
    <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      <Loader2 size={11} className="animate-spin text-primary" />
      <span>working</span>
    </div>
  );
}

function ThinkingBlock({ block, live = false }: { block: Extract<NonNullable<PiMessage["contentBlocks"]>[number], { type: "thinking" }>; live?: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const text = block.redacted ? "Thinking redacted by provider safety filters." : block.thinking.trim();
  useEffect(() => {
    if (live) setExpanded(true);
    else setExpanded(false);
  }, [live]);
  if (!text) return null;
  return (
    <div className="rounded-none border border-border bg-background/60 text-muted-foreground">
      <button type="button" className="group flex w-full cursor-pointer items-center gap-1.5 rounded-none px-2 py-1.5 text-left font-mono text-[11px] leading-5 transition hover:bg-muted/70" onClick={() => setExpanded((value) => !value)}>
        <span className="flex size-4 shrink-0 items-center justify-center rounded-none bg-surface"><Brain size={13} className="text-primary" /></span>
        <span className="w-16 shrink-0 truncate font-semibold text-foreground">thinking</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{compactThinkingPreview(text)}</span>
        <ChevronRight className={cn("text-muted-foreground transition group-hover:translate-x-0.5", expanded && "rotate-90")} size={12} />
      </button>
      {expanded ? <div className="border-t border-border bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5"><MarkdownContent content={text} /></div> : null}
    </div>
  );
}

function ImageBlock({ block }: { block: Extract<NonNullable<PiMessage["contentBlocks"]>[number], { type: "image" }> }) {
  const src = block.url ?? (block.data && block.mimeType ? `data:${block.mimeType};base64,${block.data}` : undefined);
  if (!src) {
    return <div className="flex items-center gap-2 border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><ImageIcon size={13} /> image content unavailable</div>;
  }
  return <img src={src} alt={block.alt ?? "AI image content"} className="max-h-80 max-w-full border border-border bg-background object-contain" />;
}

function UnknownBlock({ label, value }: { label: string; value?: unknown }) {
  return (
    <details className="border border-border bg-muted/35 p-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-mono uppercase tracking-[0.12em]">{label}</summary>
      {value ? <pre className="mt-2 overflow-x-auto bg-background/70 p-2 font-mono text-[11px] leading-4">{JSON.stringify(value, null, 2)}</pre> : null}
    </details>
  );
}

function AssistantStopState({ message }: { message: PiMessage }) {
  if (message.stopReason === "aborted") return <div className="text-xs text-danger">{message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : "Operation aborted"}</div>;
  if (message.stopReason === "error") return <div className="text-xs text-danger">Error: {message.errorMessage ?? "Unknown error"}</div>;
  if (message.stopReason === "length") return <div className="text-xs text-warning">Response stopped: length limit reached.</div>;
  return null;
}

function SummaryMessage({ kind, message }: { kind: "branch" | "compaction"; message: PiMessage }) {
  const [expanded, setExpanded] = useState(false);
  const title = kind === "branch" ? "Branch summary" : "Compaction summary";
  const subtitle = kind === "compaction" && typeof message.tokensBefore === "number" ? `Compacted from ${message.tokensBefore.toLocaleString()} tokens` : "Conversation context summary";
  return (
    <article className="mx-auto max-w-[min(42rem,96%)] border border-border bg-muted/45 p-3 text-[13px] leading-5 text-foreground">
      <button type="button" className="flex w-full cursor-pointer items-center gap-2 text-left" onClick={() => setExpanded((value) => !value)}>
        <FileText size={14} className="text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground">{title}</span>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{expanded ? "hide" : "expand"}</span>
      </button>
      <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      {expanded ? <div className="mt-3 border-t border-border pt-3"><MarkdownContent content={message.content} /></div> : null}
    </article>
  );
}

function CustomMessage({ message }: { message: PiMessage }) {
  return (
    <article className="max-w-[min(42rem,96%)] border border-primary/15 bg-primary/[0.045] p-3 text-[13px] leading-5 text-foreground">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">[{message.customType ?? "custom"}]</div>
      <MarkdownContent content={message.content} />
    </article>
  );
}

function BashExecutionMessage({ message }: { message: PiMessage }) {
  return (
    <article className="max-w-[min(44rem,96%)] border border-border bg-surface/82 p-3 text-[13px] leading-5 text-foreground">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><Terminal size={13} className="text-primary" /> bash execution {message.excludeFromContext ? <span>· excluded</span> : null}</div>
      <pre className="overflow-x-auto border border-border bg-background/80 p-3 font-mono text-[12px] leading-5">{message.content || "No output"}</pre>
      <div className="mt-2 flex gap-3 font-mono text-[10px] text-muted-foreground">{message.cancelled ? <span>cancelled</span> : null}{message.truncated ? <span>truncated</span> : null}{message.fullOutputPath ? <span className="truncate">full: {message.fullOutputPath}</span> : null}</div>
    </article>
  );
}

function ToolResultMessage({ message, onSelectTool }: { message: PiMessage; onSelectTool?: (tool: PiToolCall) => void }) {
  const tool = messageToToolCall(message);
  if (tool) {
    return (
      <article className="max-w-[min(44rem,96%)]">
        <ToolCallItem tool={tool} onSelect={onSelectTool} />
      </article>
    );
  }

  return (
    <article className={cn("max-w-[min(44rem,96%)] border p-3 text-[13px] leading-5", message.isError ? "border-danger/25 bg-danger/5 text-danger" : "border-border bg-muted/35 text-foreground")}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">tool result {message.toolName ? `· ${message.toolName}` : ""}</div>
      {message.contentBlocks?.length ? <AssistantBlocks message={message} fallback={message.content} /> : <MarkdownContent content={message.content || "No result content"} />}
    </article>
  );
}

function messageToToolCall(message: PiMessage): PiToolCall | null {
  if (!message.toolName) return null;
  return {
    id: message.toolCallId ?? message.id,
    name: message.toolName,
    target: extractToolTargetFromMessage(message),
    status: message.isError ? "error" : "success",
    summary: message.isError ? "Tool failed" : "Tool complete",
    output: message.content,
    args: message.toolArgs,
    details: message.toolDetails,
    isError: message.isError,
  };
}

function extractToolTargetFromMessage(message: PiMessage): string {
  const args = message.toolArgs;
  if (message.toolName === "bash" && typeof args?.command === "string") return args.command;
  if ((message.toolName === "read" || message.toolName === "edit" || message.toolName === "write") && typeof args?.path === "string") return args.path;
  if (typeof args?.pattern === "string") return args.pattern;
  return message.toolName ?? "tool";
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-primary/45 bg-muted/45 px-3 py-2 text-muted-foreground">{children}</blockquote>,
        a: ({ children, href }) => (
          <a className="text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary" href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        code: ({ children }) => <code className="bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>,
        pre: ({ children }) => <pre className="my-2 overflow-x-auto border border-border bg-background/80 p-3 text-[12px] leading-5">{children}</pre>,
        table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
        th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageTimeline({ items, activeId, onJump }: { items: TimelineItem[]; activeId: string | null; onJump: (id: string) => void }) {
  const { t } = useI18n();
  const denominator = Math.max(items.length - 1, 1);

  return (
    <nav className="pointer-events-none absolute bottom-5 right-2 top-5 hidden w-7 sm:block" aria-label={t("message.timelineLabel")}>
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/80" />
      {items.map((item, index) => {
        const nearbyItems = getNearbyTimelineItems(items, index, 7);
        const hoveredNearbyIndex = Math.max(nearbyItems.findIndex((nearbyItem) => nearbyItem.id === item.id), 0);
        const isActive = item.id === activeId;
        return (
          <div
            key={item.id}
            className="group pointer-events-auto absolute left-1/2 flex -translate-x-1/2 cursor-pointer items-center justify-center"
            style={{ top: `${(index / denominator) * 100}%` }}
            onPointerDown={(event) => {
              event.preventDefault();
              onJump(item.id);
            }}
          >
            <button
              type="button"
              className="flex h-6 w-4 cursor-pointer items-center justify-center"
              aria-label={`${item.author} ${item.time}: ${item.summary}`}
              onClick={(event) => {
                event.stopPropagation();
                onJump(item.id);
              }}
            >
              <span
                className={cn(
                  "pointer-events-none h-5 w-2 cursor-pointer !rounded-full border border-background shadow-sm transition group-hover:h-6 group-hover:bg-primary",
                  isActive ? "h-7 w-2.5 bg-primary shadow-[0_0_0_4px_oklch(0.48_0.075_255/0.14)]" : "bg-foreground/70",
                )}
              />
            </button>
            <div
              className="absolute right-0 top-1/2 z-30 hidden w-80 pr-5 text-left group-hover:block"
              style={{ transform: `translateY(-${hoveredNearbyIndex * 32 + 16}px)` }}
            >
              <div className="border border-border bg-popover/96 p-1.5 shadow-[0_16px_45px_rgb(44_54_70/0.16)] backdrop-blur">
                <div className="space-y-0.5">
                  {nearbyItems.map((nearbyItem) => (
                    <button
                      key={nearbyItem.id}
                      type="button"
                      className={cn(
                        "block h-8 w-full cursor-pointer border border-transparent px-2 text-left transition hover:border-border hover:bg-muted/60",
                        nearbyItem.id === item.id && "border-primary/25 bg-primary/10",
                      )}
                      onClick={() => onJump(nearbyItem.id)}
                    >
                      <span className="block truncate text-[11px] leading-8 text-foreground">{nearbyItem.summary}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function isGroupableActivityMessage(message: PiMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.stopReason === "aborted" || message.stopReason === "error" || message.stopReason === "length") return false;
  if (stripToolMarkers(message.content).trim()) return false;
  return Boolean(message.contentBlocks?.some((block) => block.type !== "text" && block.type !== "toolCall"));
}

function isHiddenAssistantMessage(message: PiMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.stopReason === "aborted" || message.stopReason === "error" || message.stopReason === "length") return false;
  if (message.contentBlocks?.some((block) => block.type === "text" ? stripToolMarkers(block.text).trim() : block.type !== "toolCall")) return false;
  return !stripToolMarkers(message.content).trim();
}

function shouldRenderAssistantBlocks(message: PiMessage): boolean {
  if (!message.contentBlocks?.length) return false;
  return message.contentBlocks.some((block) => block.type !== "text" && block.type !== "toolCall");
}

function getCopyText(message: PiMessage, fallback: string): string {
  if (message.contentBlocks?.length) {
    return message.contentBlocks
      .map((block) => {
        if (block.type === "text") return stripToolMarkers(block.text);
        if (block.type === "thinking") return block.thinking;
        if (block.type === "toolCall") return "";
        if (block.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return fallback.trim();
}

function stripToolMarkers(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[tool:/i.test(line))
    .join("\n")
    .trim();
}

function findLastAssistantId(messages: PiMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") return messages[index].id;
  }
  return null;
}

function isScrollAtBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 32;
}

function isPromptStart(messages: PiMessage[], activeAssistantId: string | null): boolean {
  const last = messages[messages.length - 1];
  const previous = messages[messages.length - 2];
  return Boolean(
    activeAssistantId &&
      last?.id === activeAssistantId &&
      previous?.role === "user" &&
      !last.content.trim() &&
      !last.contentBlocks?.length &&
      !last.tools?.length,
  );
}

function buildStreamSignature(messages: PiMessage[]): string {
  return messages
    .map((message) => {
      const blocks = message.contentBlocks?.map((block) => {
        if (block.type === "text") return `t:${block.text.length}`;
        if (block.type === "thinking") return `h:${block.thinking.length}:${block.redacted ? 1 : 0}`;
        if (block.type === "toolCall") return `c:${block.id ?? ""}:${block.name}:${JSON.stringify(block.arguments ?? {}).length}`;
        if (block.type === "image") return "i";
        return `u:${block.label}`;
      }).join(",") ?? "";
      const tools = message.tools?.map((tool) => `${tool.id}:${tool.status}:${tool.output?.length ?? 0}`).join(",") ?? "";
      return `${message.id}:${message.role}:${message.content.length}:${blocks}:${tools}:${message.stopReason ?? ""}`;
    })
    .join("|");
}

function getNearbyTimelineItems(items: TimelineItem[], activeIndex: number, limit: number): TimelineItem[] {
  const half = Math.floor(limit / 2);
  const maxStart = Math.max(items.length - limit, 0);
  const start = Math.min(Math.max(activeIndex - half, 0), maxStart);
  return items.slice(start, start + limit);
}

function buildRenderItems(messages: PiMessage[], activeAssistantId: string | null): RenderItem[] {
  const items: RenderItem[] = [];
  let pendingTools: PiToolCall[] = [];
  let pendingMessages: PiMessage[] = [];
  let pendingId: string | null = null;

  function addPendingMessage(message: PiMessage) {
    pendingId ??= message.id;
    pendingMessages.push(message);
  }

  function addPendingTool(message: PiMessage, tool: PiToolCall) {
    pendingId ??= message.id;
    pendingTools.push(tool);
  }

  function flushActivity() {
    if (!pendingTools.length && !pendingMessages.length) return;
    items.push({ type: "activityGroup", id: pendingId ?? pendingTools[0]?.id ?? pendingMessages[0].id, tools: pendingTools, messages: pendingMessages });
    pendingTools = [];
    pendingMessages = [];
    pendingId = null;
  }

  for (const message of messages) {
    if (message.role === "toolResult") {
      const tool = messageToToolCall(message);
      if (tool) {
        addPendingTool(message, tool);
        continue;
      }
    }

    if (message.id !== activeAssistantId && isGroupableActivityMessage(message)) {
      addPendingMessage(message);
      continue;
    }

    flushActivity();
    items.push({ type: "message", message });
  }

  flushActivity();
  return items;
}

function buildTimelineItems(messages: PiMessage[], t: (key: string) => string): TimelineItem[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      id: message.id,
      role: message.role,
      author: t("message.you"),
      time: message.createdAt,
      summary: summarizeMessage(message, t),
    }));
}

function summarizeMessage(message: PiMessage, t: (key: string) => string): string {
  const text = message.content.replace(/[#*_`>\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 150 ? `${text.slice(0, 147)}…` : text;
  if (message.tools?.length) return `${t("message.toolsLabel")} · ${message.tools.map((tool) => tool.name).join(", ")}`;
  return t("message.thinking");
}
