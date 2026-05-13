import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Loader2 } from "lucide-react";
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
  onSelectTool?: (tool: PiToolCall) => void;
}

interface TimelineItem {
  id: string;
  role: PiMessage["role"];
  author: string;
  time: string;
  summary: string;
}

export function MessageList({ messages, isConnecting = false, isRefreshing = false, isSwitchingSession = false, onSelectTool }: MessageListProps) {
  const { t } = useI18n();
  const showEmptyState = !messages.length && !isConnecting;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const timelineItems = useMemo(() => buildTimelineItems(messages, t), [messages, t]);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(timelineItems[0]?.id ?? null);

  useEffect(() => {
    if (!timelineItems.length) {
      setActiveTimelineId(null);
      return;
    }
    setActiveTimelineId((current) => (current && timelineItems.some((item) => item.id === current) ? current : timelineItems[0].id));
  }, [timelineItems]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || isConnecting || isSwitchingSession) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    updateActiveTimelineItem();
  }, [messages.length, isConnecting, isSwitchingSession]);

  function updateActiveTimelineItem() {
    if (!scrollRef.current || !timelineItems.length) return;
    const containerRect = scrollRef.current.getBoundingClientRect();
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
    <div className="relative z-30 min-h-0 flex-1">
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
            {messages.map((message) => {
              if (isHiddenAssistantMessage(message)) return null;
              return (
                <div
                  key={message.id}
                  ref={(node) => {
                    if (node) messageRefs.current.set(message.id, node);
                    else messageRefs.current.delete(message.id);
                  }}
                  className="scroll-mt-16"
                >
                  <MessageBubble message={message} onSelectTool={onSelectTool} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {timelineItems.length ? <MessageTimeline items={timelineItems} activeId={activeTimelineId} onJump={scrollToMessage} /> : null}
    </div>
  );
}

function MessageBubble({ message, onSelectTool }: { message: PiMessage; onSelectTool?: (tool: PiToolCall) => void }) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const author = isSystem ? "system" : "pi";
  const displayContent = !isUser && !isSystem ? stripToolMarkers(message.content) : message.content;
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    const text = displayContent.trim();
    if (!text) return;
    await copyTextToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (isSystem) {
    return (
      <article className="mx-auto max-w-[min(34rem,92%)] border border-border bg-muted/50 px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
        {message.content || <span>{t("message.thinking")}</span>}
      </article>
    );
  }

  return (
    <article className={cn("flex w-full gap-2.5", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0", isUser ? "flex max-w-[min(34rem,86%)] flex-col items-end" : "max-w-[min(44rem,94%)] flex-1")}>
        {isSystem ? (
          <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
            <span className="font-mono font-semibold uppercase tracking-[0.12em] text-foreground/75">{author}</span>
            <span className="font-mono">{message.createdAt}</span>
          </div>
        ) : null}

        {isUser ? <UserContent message={message} /> : <AssistantContent content={displayContent} createdAt={message.createdAt} hasTools={Boolean(message.tools?.length)} />}
        {displayContent.trim() ? <CopyAction align={isUser ? "right" : "left"} copied={copied} onCopy={copyMessage} /> : null}

        {message.tools?.length ? (
          <div className="mt-2 w-full border border-border bg-surface/70 p-2 shadow-sm">
            <div className="mb-1.5 flex items-center justify-between px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>{t("message.toolsLabel")}</span>
              <span>{message.tools.length}</span>
            </div>
            <div className="space-y-1.5">
              {message.tools.map((tool) => (
                <ToolCallItem key={tool.id} tool={tool} onSelect={onSelectTool} />
              ))}
            </div>
          </div>
        ) : null}
      </div>


    </article>
  );
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

function AssistantContent({ content, createdAt, hasTools }: { content: string; createdAt: string; hasTools: boolean }) {
  const hasContent = Boolean(content.trim());
  if (!hasContent && hasTools) return null;

  return (
    <div>
      <div className="mb-1 px-1 font-mono text-[10px] text-muted-foreground">{createdAt}</div>
      <div className="overflow-hidden border border-border bg-surface/82 text-foreground shadow-[0_10px_30px_rgb(44_54_70/0.055)]">
        <div className="px-3.5 py-3 text-[13px] leading-5">
          {hasContent ? <MarkdownContent content={content} /> : null}
        </div>
      </div>
    </div>
  );
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
              className="absolute right-0 top-1/2 z-[200] hidden w-80 pr-5 text-left group-hover:block"
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

function isHiddenAssistantMessage(message: PiMessage): boolean {
  if (message.role !== "assistant") return false;
  return !stripToolMarkers(message.content).trim();
}

function stripToolMarkers(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[tool:/i.test(line))
    .join("\n")
    .trim();
}

function getNearbyTimelineItems(items: TimelineItem[], activeIndex: number, limit: number): TimelineItem[] {
  const half = Math.floor(limit / 2);
  const maxStart = Math.max(items.length - limit, 0);
  const start = Math.min(Math.max(activeIndex - half, 0), maxStart);
  return items.slice(start, start + limit);
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
