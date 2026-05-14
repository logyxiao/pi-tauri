import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Brain, Check, ChevronRight, Copy, FilePenLine, FileText, ImageIcon, Loader2, Terminal } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { LoadingPanel } from "@/components/status/LoadingPanel";
import { ToolCallItem } from "@/components/tools/ToolCallItem";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiMessage, PiMessageContentBlock, PiToolCall } from "@/shared/pi/types";

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
  | { type: "message"; message: PiMessage; activityTools?: PiToolCall[]; activityMessages?: PiMessage[] }
  | { type: "activityGroup"; id: string; tools: PiToolCall[]; messages: PiMessage[] };

const MESSAGE_WINDOW_INITIAL = 160;
const MESSAGE_WINDOW_STEP = 160;

export function MessageList({ messages, isConnecting = false, isRefreshing = false, isSwitchingSession = false, isRunning = false, onSelectTool }: MessageListProps) {
  const { t } = useI18n();
  const showEmptyState = !messages.length && !isConnecting;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const shouldAutoScrollRef = useRef(true);
  const activeTimelineIdRef = useRef<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [messageWindowSize, setMessageWindowSize] = useState(MESSAGE_WINDOW_INITIAL);
  const visibleMessages = useMemo(() => messages.length > messageWindowSize ? messages.slice(-messageWindowSize) : messages, [messages, messageWindowSize]);
  const hiddenMessageCount = Math.max(messages.length - visibleMessages.length, 0);
  const timelineItems = useMemo(() => buildTimelineItems(visibleMessages, t), [visibleMessages, t]);
  const activeAssistantId = isRunning ? findLastAssistantId(visibleMessages) : null;
  const renderItems = useMemo(() => buildRenderItems(visibleMessages, activeAssistantId), [visibleMessages, activeAssistantId]);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(timelineItems[0]?.id ?? null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const streamSignature = useMemo(() => buildStreamSignature(visibleMessages), [visibleMessages]);
  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRenderItemHeight(renderItems[index]),
    getItemKey: (index) => renderItemKey(renderItems[index], index),
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    setMessageWindowSize((current) => Math.max(MESSAGE_WINDOW_INITIAL, Math.min(current, Math.max(messages.length, MESSAGE_WINDOW_INITIAL))));
  }, [messages.length]);

  useEffect(() => {
    activeTimelineIdRef.current = activeTimelineId;
  }, [activeTimelineId]);

  useEffect(() => {
    if (!timelineItems.length) {
      activeTimelineIdRef.current = null;
      setActiveTimelineId(null);
      return;
    }
    setActiveTimelineId((current) => (current && timelineItems.some((item) => item.id === current) ? current : timelineItems[0].id));
  }, [timelineItems]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) window.cancelAnimationFrame(scrollRafRef.current);
  }, []);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || isConnecting || isSwitchingSession) return;
    if (isPromptStart(messages, activeAssistantId)) shouldAutoScrollRef.current = true;
    if (!shouldAutoScrollRef.current) return;
    virtualizer.scrollToIndex(Math.max(renderItems.length - 1, 0), { align: "end" });
    setShowScrollToBottom(false);
    updateActiveTimelineItem();
  }, [streamSignature, isConnecting, isSwitchingSession, visibleMessages, activeAssistantId, renderItems.length, virtualizer]);

  function scheduleTimelineUpdate() {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateActiveTimelineItem();
    });
  }

  function updateActiveTimelineItem() {
    const container = scrollRef.current;
    if (!container) return;
    const atBottom = isScrollAtBottom(container);
    shouldAutoScrollRef.current = atBottom;
    setShowScrollToBottom((current) => (current === !atBottom ? current : !atBottom));
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

    if (activeTimelineIdRef.current !== nearestId) {
      activeTimelineIdRef.current = nearestId;
      setActiveTimelineId(nearestId);
    }
  }

  function scrollToBottom() {
    const container = scrollRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = true;
    virtualizer.scrollToIndex(Math.max(renderItems.length - 1, 0), { align: "end", behavior: "smooth" });
    setShowScrollToBottom(false);
  }

  function scrollToMessage(id: string) {
    const container = scrollRef.current;
    if (!container) return;

    setActiveTimelineId(id);
    const itemIndex = renderItems.findIndex((item) => item.type === "message" && item.message.id === id);
    if (itemIndex >= 0 && !messageRefs.current.get(id)) {
      virtualizer.scrollToIndex(itemIndex, { align: "start" });
      window.requestAnimationFrame(() => scrollToMessage(id));
      return;
    }
    const node = messageRefs.current.get(id);
    if (!node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const safeBottom = 180;
    const targetTop = container.scrollTop + nodeRect.top - containerRect.top - container.clientHeight * 0.28;
    const maxTop = Math.max(container.scrollHeight - container.clientHeight + safeBottom, 0);
    container.scrollTo({ top: Math.min(Math.max(targetTop, 0), maxTop), behavior: "auto" });
  }

  function showEarlierMessages() {
    const container = scrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;
    setMessageWindowSize((current) => current + MESSAGE_WINDOW_STEP);
    window.requestAnimationFrame(() => {
      const nextContainer = scrollRef.current;
      if (!nextContainer) return;
      nextContainer.scrollTop = previousTop + Math.max(nextContainer.scrollHeight - previousHeight, 0);
    });
  }

  return (
    <div className="relative z-10 min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="message-list-scrollbar h-full overflow-y-auto overflow-x-hidden px-3 py-4 pr-9 sm:px-5 sm:py-6 sm:pr-12"
        aria-label={t("message.listLabel")}
        onScroll={scheduleTimelineUpdate}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-36">
          {isConnecting || isSwitchingSession ? <LoadingPanel label={isSwitchingSession ? t("loading.session") : undefined} /> : null}

          {isRefreshing && messages.length ? (
            <div className="inline-flex w-fit items-center gap-2 border border-border bg-surface/85 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
              <Loader2 size={11} className="animate-spin text-primary" /> {t("message.refreshing")}
            </div>
          ) : null}

          {showEmptyState ? <div className="min-h-[28vh]" /> : null}

          {hiddenMessageCount ? (
            <button
              type="button"
              className="mx-auto w-fit cursor-pointer border border-border bg-surface/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm transition hover:border-primary/30 hover:text-primary"
              onClick={showEarlierMessages}
            >
              Show {Math.min(MESSAGE_WINDOW_STEP, hiddenMessageCount)} earlier messages
            </button>
          ) : null}

          <div>
            <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualItems.map((virtualItem) => {
              const item = renderItems[virtualItem.index];
              if (item.type === "message") {
                const isActiveAssistant = item.message.id === activeAssistantId;
                if (!isActiveAssistant && isHiddenAssistantMessage(item.message) && !item.activityTools?.length && !item.activityMessages?.length) return null;
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={(node) => {
                      virtualizer.measureElement(node);
                      if (node) messageRefs.current.set(item.message.id, node);
                      else messageRefs.current.delete(item.message.id);
                    }}
                    className="absolute left-0 top-0 w-full scroll-mt-16"
                    style={{ transform: `translateY(${virtualItem.start}px)`, paddingBottom: "1rem" }}
                  >
                    <MessageBubble message={item.message} activityTools={item.activityTools} activityMessages={item.activityMessages} onSelectTool={onSelectTool} isActive={isActiveAssistant} />
                  </div>
                );
              }

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={(node) => virtualizer.measureElement(node)}
                  className="absolute left-0 top-0 w-full scroll-mt-16"
                  style={{ transform: `translateY(${virtualItem.start}px)`, paddingBottom: "1rem" }}
                >
                  <ActivityGroup tools={item.tools} messages={item.messages} onSelectTool={onSelectTool} live={isRunning} />
                </div>
              );
            })}
            </div>
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

function MessageBubble({ message, activityTools = [], activityMessages = [], onSelectTool, isActive = false }: { message: PiMessage; activityTools?: PiToolCall[]; activityMessages?: PiMessage[]; onSelectTool?: (tool: PiToolCall) => void; isActive?: boolean }) {
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
          <AssistantContent message={message} content={displayContent} createdAt={message.createdAt} activityTools={activityTools} activityMessages={activityMessages} isActive={isActive} onSelectTool={onSelectTool} />
        )}
        {getCopyText(message, displayContent) ? <CopyAction align={isUser ? "right" : "left"} copied={copied} onCopy={copyMessage} /> : null}
      </div>
    </article>
  );
}

function ActivityGroup({ tools, messages, onSelectTool, className, live = false, label = "活动" }: { tools: PiToolCall[]; messages: PiMessage[]; onSelectTool?: (tool: PiToolCall) => void; className?: string; live?: boolean; label?: string }) {
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
        <span className="shrink-0 text-[10px] font-medium text-foreground">{label}</span>
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

function EditedFilesPanel({ tools, onSelectTool, live = false }: { tools: PiToolCall[]; onSelectTool?: (tool: PiToolCall) => void; live?: boolean }) {
  const files = Array.from(new Set(tools.map(compactToolTarget).filter(Boolean)));
  return (
    <section className="overflow-hidden border border-border bg-background/55">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/70 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <FilePenLine size={13} className="shrink-0 text-primary" />
          <span className="font-semibold text-foreground">{files.length || tools.length} 个文件已更改</span>
          <span className="text-success">+{tools.filter((tool) => tool.status === "success").length}</span>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">编辑结果</span>
      </div>
      <div className="divide-y divide-border">
        {tools.map((tool) => (
          <ToolCallItem key={tool.id} tool={tool} onSelect={onSelectTool} defaultExpanded={live} />
        ))}
      </div>
    </section>
  );
}

function summarizeActivity(tools: PiToolCall[], messages: PiMessage[]): string[] {
  return [...summarizeTools(tools), ...summarizeGroupedMessages(messages)];
}

function buildAssistantRenderPlan(message: PiMessage, activityTools: PiToolCall[], activityMessages: PiMessage[], live: boolean) {
  const tools = message.tools ?? [];
  const inlineToolIds = new Set<string>();
  for (const block of message.contentBlocks ?? []) {
    if (block.type !== "toolCall") continue;
    const tool = findToolForBlock(block, tools);
    if (tool) inlineToolIds.add(tool.id);
  }
  if (live) {
    return {
      processedTools: activityTools,
      processedMessages: activityMessages,
      fileTools: [] as PiToolCall[],
      inlineTools: tools,
      remainingTools: [] as PiToolCall[],
    };
  }

  const inlineTools = uniqueTools(tools.filter((tool) => inlineToolIds.has(tool.id)));
  const nonInlineTools = uniqueTools(tools.filter((tool) => !inlineToolIds.has(tool.id)));
  const allActivityTools = uniqueTools([...activityTools, ...nonInlineTools]);
  const blockFileTools = inlineTools.filter(isFileEditTool);
  const fileTools = [...allActivityTools, ...blockFileTools].filter(isFileEditTool);
  const processedTools = [...allActivityTools, ...inlineTools].filter((tool) => !isFileEditTool(tool));
  const blockActivityMessage = nonTextAssistantActivityMessage(message);
  const processedMessages = [
    ...activityMessages.filter((item) => !isTextOnlyAssistantMessage(item)),
    ...(blockActivityMessage ? [blockActivityMessage] : []),
  ];
  return {
    processedTools,
    processedMessages,
    fileTools,
    inlineTools: [] as PiToolCall[],
    remainingTools: [] as PiToolCall[],
  };
}

function uniqueTools(tools: PiToolCall[]): PiToolCall[] {
  const byId = new Map<string, PiToolCall>();
  for (const tool of tools) byId.set(tool.id, byId.has(tool.id) ? { ...byId.get(tool.id), ...tool } : tool);
  return Array.from(byId.values());
}

function isFileEditTool(tool: PiToolCall): boolean {
  const name = tool.name.toLowerCase();
  if (name === "edit" || name === "write") return true;
  if (name === "apply_patch" || name === "patch") return true;
  if (name === "bash") {
    const command = getToolArgString(tool, "command") || tool.target;
    return /\bapply_patch\b/.test(command);
  }
  return name.includes("edit") || name.includes("write") || name.includes("patch");
}

function isTextOnlyAssistantMessage(message: PiMessage): boolean {
  if (message.role !== "assistant") return false;
  const text = stripToolMarkers(message.content).trim();
  if (text) return true;
  return Boolean(message.contentBlocks?.length && message.contentBlocks.every((block) => block.type === "text" ? stripToolMarkers(block.text).trim() : false));
}

function nonTextAssistantActivityMessage(message: PiMessage): PiMessage | null {
  const blocks = message.contentBlocks?.filter((block) => block.type !== "text" && block.type !== "toolCall") ?? [];
  if (!blocks.length) return null;
  return {
    ...message,
    id: `${message.id}:processed`,
    content: "",
    contentBlocks: blocks,
    tools: [],
  };
}

function textOnlyAssistantMessage(message: PiMessage): PiMessage {
  if (!message.contentBlocks?.length) return message;
  return {
    ...message,
    contentBlocks: message.contentBlocks.filter((block) => block.type === "text"),
    tools: [],
  };
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

function AssistantContent({
  message,
  content,
  createdAt,
  activityTools = [],
  activityMessages = [],
  isActive,
  onSelectTool,
}: {
  message: PiMessage;
  content: string;
  createdAt: string;
  activityTools?: PiToolCall[];
  activityMessages?: PiMessage[];
  isActive: boolean;
  onSelectTool?: (tool: PiToolCall) => void;
}) {
  const hasContent = Boolean(content.trim());
  const renderBlocks = shouldRenderAssistantBlocks(message);
  const tools = message.tools ?? [];
  const hasTools = Boolean(tools.length);
  const hasInlineToolBlocks = Boolean(message.contentBlocks?.some((block) => block.type === "toolCall"));
  const showWorking = isActive && !hasContent && !renderBlocks && !hasTools;
  const plan = buildAssistantRenderPlan(message, activityTools, activityMessages, isActive);
  const textOnlyMessage = isActive ? message : textOnlyAssistantMessage(message);

  return (
    <div>
      <div className="mb-1 px-1 font-mono text-[10px] text-muted-foreground">{createdAt}</div>
      <div className="overflow-hidden border border-border bg-surface/82 text-foreground shadow-[0_10px_30px_rgb(44_54_70/0.055)]">
        <div className="space-y-3 px-3.5 py-3 text-[13px] leading-5">
          {showWorking ? <WorkingBlock /> : null}
          {plan.processedTools.length || plan.processedMessages.length ? <ActivityGroup tools={plan.processedTools} messages={plan.processedMessages} onSelectTool={onSelectTool} live={isActive} label="已处理" /> : null}
          {!showWorking && (renderBlocks ? <AssistantOrderedBlocks message={textOnlyMessage} fallback={content} live={isActive} tools={plan.inlineTools} onSelectTool={onSelectTool} /> : hasContent ? <MarkdownContent content={content} /> : null)}
          {!showWorking && plan.fileTools.length ? <EditedFilesPanel tools={plan.fileTools} onSelectTool={onSelectTool} live={isActive} /> : null}
          {hasTools && !hasInlineToolBlocks && plan.remainingTools.length ? <ActivityGroup tools={plan.remainingTools} messages={[]} onSelectTool={onSelectTool} live={isActive} label={isActive ? "活动" : "已处理"} /> : null}
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

function AssistantOrderedBlocks({
  message,
  fallback,
  live = false,
  tools,
  onSelectTool,
}: {
  message: PiMessage;
  fallback: string;
  live?: boolean;
  tools: PiToolCall[];
  onSelectTool?: (tool: PiToolCall) => void;
}) {
  const blocks = message.contentBlocks?.length ? message.contentBlocks : fallback ? [{ type: "text" as const, text: fallback }] : [];
  const renderedToolIds = new Set<string>();
  const nodes = blocks.map((block, index) => {
    if (block.type === "text") return block.text.trim() ? <MarkdownContent key={`text:${index}`} content={stripToolMarkers(block.text)} /> : null;
    if (block.type === "thinking") return <ThinkingBlock key={`thinking:${index}`} block={block} live={live} />;
    if (block.type === "image") return <ImageBlock key={`image:${index}`} block={block} />;
    if (block.type === "toolCall") {
      const tool = findToolForBlock(block, tools) ?? toolFromBlock(block);
      renderedToolIds.add(tool.id);
      return <ActivityGroup key={`tool:${tool.id}:${index}`} tools={[tool]} messages={[]} onSelectTool={onSelectTool} live={live} />;
    }
    return <UnknownBlock key={`unknown:${index}`} label={block.label} value={block.value} />;
  });
  const remainingTools = tools.filter((tool) => !renderedToolIds.has(tool.id));
  return (
    <>
      {nodes}
      {remainingTools.length ? <ActivityGroup tools={remainingTools} messages={[]} onSelectTool={onSelectTool} live={live} /> : null}
    </>
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

function findToolForBlock(block: Extract<PiMessageContentBlock, { type: "toolCall" }>, tools: PiToolCall[]): PiToolCall | undefined {
  if (block.id) {
    const byId = tools.find((tool) => tool.id === block.id);
    if (byId) return byId;
  }
  const target = extractToolTargetFromBlock(block);
  return tools.find((tool) => tool.name === block.name && (!target || tool.target === target));
}

function toolFromBlock(block: Extract<PiMessageContentBlock, { type: "toolCall" }>): PiToolCall {
  return {
    id: block.id ?? `${block.name}:${JSON.stringify(block.arguments ?? {})}`,
    name: block.name,
    target: extractToolTargetFromBlock(block),
    status: "running",
    summary: "Tool pending",
    args: block.arguments,
  };
}

function extractToolTargetFromBlock(block: Extract<PiMessageContentBlock, { type: "toolCall" }>): string {
  const args = block.arguments;
  if (!args) return "";
  if (block.name === "bash" && typeof args.command === "string") return args.command;
  for (const key of ["path", "file_path", "filePath", "relativePath", "absolutePath", "target", "filename", "file", "pattern"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
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
  if (args) {
    for (const key of ["path", "file_path", "filePath", "relativePath", "absolutePath", "target", "filename", "file"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    if (typeof args.pattern === "string") return args.pattern;
  }
  return message.toolName ?? "tool";
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
  const last = messages[messages.length - 1];
  const activeAssistant = findLastAssistant(messages);
  return [
    messages.length,
    last ? compactMessageSignature(last) : "",
    activeAssistant && activeAssistant.id !== last?.id ? compactMessageSignature(activeAssistant) : "",
  ].join("|");
}

function findLastAssistant(messages: PiMessage[]): PiMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return null;
}

function compactMessageSignature(message: PiMessage): string {
  const blocksLength = message.contentBlocks?.reduce((total, block) => {
    if (block.type === "text") return total + block.text.length;
    if (block.type === "thinking") return total + block.thinking.length + (block.redacted ? 1 : 0);
    if (block.type === "toolCall") return total + (block.id?.length ?? 0) + block.name.length + JSON.stringify(block.arguments ?? {}).length;
    if (block.type === "image") return total + 1;
    return total + block.label.length;
  }, 0) ?? 0;
  const toolsLength = message.tools?.reduce((total, tool) => total + tool.id.length + tool.status.length + (tool.output?.length ?? 0), 0) ?? 0;
  return `${message.id}:${message.role}:${message.content.length}:${blocksLength}:${toolsLength}:${message.stopReason ?? ""}`;
}

function estimateRenderItemHeight(item: RenderItem | undefined): number {
  if (!item) return 120;
  if (item.type === "activityGroup") return Math.min(360, 64 + (item.tools.length + item.messages.length) * 44);
  const message = item.message;
  if (message.role === "user") return Math.min(260, 72 + Math.ceil(message.content.length / 80) * 18);
  if (message.role === "assistant") {
    const toolCount = (message.tools?.length ?? 0) + (item.activityTools?.length ?? 0);
    const activityCount = item.activityMessages?.length ?? 0;
    return Math.min(700, 96 + Math.ceil(message.content.length / 90) * 20 + toolCount * 56 + activityCount * 48);
  }
  if (message.role === "toolResult" || message.role === "bashExecution") return 220;
  return 120;
}

function renderItemKey(item: RenderItem | undefined, index: number): string {
  if (!item) return `missing:${index}`;
  if (item.type === "activityGroup") return `activity:${item.id}`;
  return `message:${item.message.id}`;
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
    const existingIndex = pendingTools.findIndex((item) => item.id === tool.id);
    if (existingIndex >= 0) {
      pendingTools[existingIndex] = { ...pendingTools[existingIndex], ...tool };
      return;
    }
    pendingTools.push(tool);
  }

  function addPendingAssistantTools(message: PiMessage) {
    for (const tool of message.tools ?? []) {
      addPendingTool(message, tool);
    }
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

    if (message.role === "assistant" && message.id !== activeAssistantId) {
      if (isGroupableActivityMessage(message)) {
        addPendingAssistantTools(message);
        addPendingMessage(message);
        continue;
      }

      if (isHiddenAssistantMessage(message)) {
        addPendingAssistantTools(message);
        continue;
      }

      items.push({
        type: "message",
        message,
        activityTools: pendingTools.length ? pendingTools : undefined,
        activityMessages: pendingMessages.length ? pendingMessages : undefined,
      });
      pendingTools = [];
      pendingMessages = [];
      pendingId = null;
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
