import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, GitBranch, Hammer, Loader2, Terminal, User } from "lucide-react";
import { LoadingPanel } from "@/components/status/LoadingPanel";
import { ToolCallItem } from "@/components/tools/ToolCallItem";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiMessage, PiToolCall } from "@/shared/pi/types";

interface MessageListProps {
  messages: PiMessage[];
  isConnecting?: boolean;
  isRefreshing?: boolean;
  onSelectTool?: (tool: PiToolCall) => void;
}

interface TimelineItem {
  id: string;
  role: PiMessage["role"];
  author: string;
  time: string;
  summary: string;
}

export function MessageList({ messages, isConnecting = false, isRefreshing = false, onSelectTool }: MessageListProps) {
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
    setActiveTimelineId(id);
    messageRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="message-list-scrollbar h-full overflow-y-auto overflow-x-hidden px-3 py-4 pr-9 sm:px-5 sm:py-6 sm:pr-12"
        aria-label={t("message.listLabel")}
        onScroll={updateActiveTimelineItem}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2">
          {showEmptyState || isConnecting ? <HeroCard /> : null}
          {isConnecting ? <LoadingPanel /> : null}

          {isRefreshing && messages.length ? (
            <div className="inline-flex w-fit items-center gap-2 border border-border bg-surface/85 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
              <Loader2 size={11} className="animate-spin text-primary" /> {t("message.refreshing")}
            </div>
          ) : null}

          {showEmptyState ? (
            <section className="grid gap-2.5 sm:grid-cols-3">
              <EmptyCard icon={<Terminal size={14} />} title={t("message.emptyPromptTitle")} text={t("message.emptyPromptText")} />
              <EmptyCard icon={<Hammer size={14} />} title={t("message.emptyToolsTitle")} text={t("message.emptyToolsText")} />
              <EmptyCard icon={<GitBranch size={14} />} title={t("message.emptySessionTitle")} text={t("message.emptySessionText")} />
            </section>
          ) : null}

          <div className="flex flex-col gap-4">
            {messages.map((message) => (
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
            ))}
          </div>
        </div>
      </div>

      {timelineItems.length ? <MessageTimeline items={timelineItems} activeId={activeTimelineId} onJump={scrollToMessage} /> : null}
    </div>
  );
}

function HeroCard() {
  const { t } = useI18n();
  return (
    <div className="border border-border bg-surface/72 p-4 shadow-[0_14px_42px_rgb(44_54_70/0.07)] sm:p-5">
      <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{t("message.heroKicker")}</div>
      <h1 className="font-serif text-2xl font-semibold italic tracking-tight sm:text-3xl">{t("message.heroTitle")}</h1>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground sm:text-sm">{t("message.heroText")}</p>
    </div>
  );
}

function MessageBubble({ message, onSelectTool }: { message: PiMessage; onSelectTool?: (tool: PiToolCall) => void }) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const author = isUser ? t("message.you") : isSystem ? "system" : "pi";
  const Icon = isUser ? User : Bot;

  if (isSystem) {
    return (
      <article className="mx-auto max-w-[min(34rem,92%)] border border-border bg-muted/50 px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
        {message.content || <span>{t("message.thinking")}</span>}
      </article>
    );
  }

  return (
    <article className={cn("flex w-full gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? <Avatar icon={<Icon size={13} />} /> : null}

      <div className={cn("min-w-0", isUser ? "flex max-w-[min(34rem,86%)] flex-col items-end" : "max-w-[min(44rem,94%)] flex-1")}>
        <div className={cn("mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground", isUser && "justify-end")}>
          <span className="font-mono font-semibold uppercase tracking-[0.12em] text-foreground/75">{author}</span>
          <span className="font-mono">{message.createdAt}</span>
        </div>

        {isUser ? <UserContent message={message} /> : <AssistantContent message={message} />}

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

      {isUser ? <Avatar icon={<User size={13} />} primary /> : null}
    </article>
  );
}

function UserContent({ message }: { message: PiMessage }) {
  const { t } = useI18n();
  return (
    <div className="border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-5 text-foreground shadow-[0_8px_24px_rgb(44_54_70/0.045)]">
      <div className="whitespace-pre-wrap break-words">{message.content || <span className="text-muted-foreground">{t("message.thinking")}</span>}</div>
    </div>
  );
}

function AssistantContent({ message }: { message: PiMessage }) {
  const { t } = useI18n();
  const hasContent = Boolean(message.content.trim());

  return (
    <div className="overflow-hidden border border-border bg-surface/82 text-foreground shadow-[0_10px_30px_rgb(44_54_70/0.055)]">
      <div className="border-b border-border/70 bg-muted/35 px-3 py-1.5">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">{t("message.answerLabel")}</div>
      </div>
      <div className="px-3.5 py-3 text-[13px] leading-5">
        {hasContent ? <MarkdownContent content={message.content} /> : <span className="text-muted-foreground">{t("message.thinking")}</span>}
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
        const isActive = item.id === activeId;
        return (
          <div
            key={item.id}
            className="group pointer-events-auto absolute left-1/2 flex -translate-x-1/2 cursor-pointer items-center justify-center"
            style={{ top: `${(index / denominator) * 100}%` }}
          >
            <button
              type="button"
              className="flex h-6 w-4 cursor-pointer items-center justify-center"
              aria-label={`${item.author} ${item.time}: ${item.summary}`}
              onClick={() => onJump(item.id)}
            >
              <span
                className={cn(
                  "h-5 w-2 cursor-pointer !rounded-full border border-background shadow-sm transition group-hover:h-6 group-hover:bg-primary",
                  isActive ? "h-7 w-2.5 bg-primary shadow-[0_0_0_4px_oklch(0.48_0.075_255/0.14)]" : "bg-foreground/70",
                )}
              />
            </button>
            <div className="absolute right-0 top-1/2 z-10 hidden w-80 -translate-y-1/2 pr-5 text-left group-hover:block">
              <div className="border border-border bg-popover/96 p-1.5 shadow-[0_16px_45px_rgb(44_54_70/0.16)] backdrop-blur">
                <div className="space-y-0.5">
                  {nearbyItems.map((nearbyItem) => (
                    <button
                      key={nearbyItem.id}
                      type="button"
                      className={cn(
                        "block w-full cursor-pointer border border-transparent px-2 py-1.5 text-left transition hover:border-border hover:bg-muted/60",
                        nearbyItem.id === item.id && "border-primary/25 bg-primary/10",
                      )}
                      onClick={() => onJump(nearbyItem.id)}
                    >
                      <span className="block truncate text-[11px] leading-5 text-foreground">{nearbyItem.summary}</span>
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

function Avatar({ icon, primary = false }: { icon: ReactNode; primary?: boolean }) {
  return (
    <div
      className={cn(
        "mt-5 hidden size-7 shrink-0 items-center justify-center border shadow-sm sm:flex",
        primary ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-surface/75 text-muted-foreground",
      )}
    >
      {icon}
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
    <div className="border border-border bg-surface/62 p-3 shadow-[0_10px_30px_rgb(44_54_70/0.045)]">
      <div className="mb-2 flex size-7 items-center justify-center border border-border bg-background text-primary">{icon}</div>
      <div className="text-xs font-semibold">{title}</div>
      <div className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{text}</div>
    </div>
  );
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
