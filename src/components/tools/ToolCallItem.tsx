import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Code2, FileText, Loader2, ShieldAlert, Terminal, X } from "lucide-react";
import type { PiToolCall } from "@/shared/pi/types";
import { cn } from "@/shared/lib/cn";
import { ToolResultPanel } from "./ToolResultPanel";

interface ToolCallItemProps {
  tool: PiToolCall;
  onSelect?: (tool: PiToolCall) => void;
  defaultExpanded?: boolean;
}

export function ToolCallItem({ tool, onSelect, defaultExpanded = false }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = useMemo(() => buildToolSummary(tool), [tool]);
  const canExpand = tool.name === "read" || tool.name === "edit" || tool.name === "write" || tool.name === "bash";
  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
    else setExpanded(false);
  }, [defaultExpanded]);
  const icon =
    tool.status === "running" ? (
      <Loader2 className="animate-spin text-primary" size={13} />
    ) : tool.status === "success" ? (
      <Check className="text-success" size={13} />
    ) : (
      <X className="text-danger" size={13} />
    );

  return (
    <div className="rounded-none border border-border bg-background/60">
      <button
        type="button"
        className="cursor-pointer group flex w-full items-center gap-1.5 rounded-none px-2 py-1.5 text-left font-mono text-[11px] leading-5 transition hover:bg-muted/70"
        onClick={() => {
          if (canExpand) setExpanded((value) => !value);
          onSelect?.(tool);
        }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center rounded-none bg-surface">{icon}</span>
        <ToolKindIcon name={tool.name} />
        <span className="w-10 shrink-0 truncate font-semibold text-foreground">{tool.name}</span>
        {tool.safety ? <ShieldAlert size={12} className="shrink-0 text-danger" /> : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          <span>{summary.prefix}</span>
          {summary.path ? <span className="font-mono text-primary">{summary.path}</span> : null}
          {summary.suffix ? <span>{summary.suffix}</span> : null}
        </span>
        <span
          className={cn(
            "rounded-none px-1.5 py-0 text-[10px] font-medium leading-5",
            tool.status === "running" && "bg-primary/10 text-primary",
            tool.status === "success" && "bg-success/10 text-success",
            tool.status === "error" && "bg-danger/10 text-danger",
          )}
        >
          {formatToolStatus(tool)}
        </span>
        {canExpand ? (
          <ChevronRight className={cn("text-muted-foreground transition group-hover:translate-x-0.5", expanded && "rotate-90")} size={12} />
        ) : null}
      </button>

      {expanded && canExpand ? (
        <>
          <ExpandedToolContent tool={tool} summary={summary} />
          {tool.safety ? (
            <div className="mt-2 rounded-none border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
              {tool.safety.severity}: {tool.safety.reason}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatToolStatus(tool: PiToolCall): string {
  if (tool.status === "running") return "running";
  if (typeof tool.durationMs === "number") return `${tool.durationMs}ms`;
  if (tool.status === "error") return "failed";
  return "done";
}

function ToolKindIcon({ name }: { name: string }) {
  if (name === "bash") return <Terminal size={12} className="shrink-0 text-primary" />;
  if (name === "edit" || name === "write") return <Code2 size={12} className="shrink-0 text-primary" />;
  return <FileText size={12} className="shrink-0 text-primary" />;
}

function ExpandedToolContent({ tool, summary }: { tool: PiToolCall; summary: ToolSummary }) {
  if (tool.name === "read") return <CodePreview tool={tool} title="read" path={summary.path} range={summary.range} content={tool.output} />;
  if (tool.name === "edit") return summary.diff ? <DiffPreview diff={summary.diff} /> : <ToolMetadata tool={tool} summary={summary} label="edited" />;
  if (tool.name === "write") return <CodePreview tool={tool} title="write" path={summary.path} content={getStringArg(tool, "content") ?? tool.output} />;
  return <ToolResultPanel tool={tool} />;
}

function ToolMetadata({ tool, summary, label }: { tool: PiToolCall; summary: ToolSummary; label: string }) {
  return (
    <div className="border-t border-border bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground">
      <div>
        {label} <span className="font-mono text-primary">{summary.path || tool.target || "unknown"}</span>
      </div>
      {tool.summary ? <div>{tool.summary}</div> : null}
    </div>
  );
}

function CodePreview({ title, path, range, content }: { tool: PiToolCall; title: string; path?: string; range?: string; content?: string }) {
  const lines = (content ?? "").split(/\r?\n/);
  const displayLines = stripReadContinuation(lines).slice(0, 80);
  const remaining = Math.max(stripReadContinuation(lines).length - displayLines.length, 0);
  return (
    <div className="border-t border-border bg-[#1f2a20] px-2 py-1.5 font-mono text-[11px] leading-5 text-[#d7e1d2]">
      <div className="mb-1 text-[11px]">
        <span className="font-semibold text-white">{title}</span>{" "}
        {path ? <span className="text-[#7fc7bb]">{path}</span> : <span className="text-[#8b9589]">unknown</span>}
        {range ? <span className="text-[#f2d46b]">:{range}</span> : null}
      </div>
      {displayLines.length ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-5">{displayLines.join("\n")}</pre>
      ) : (
        <div className="text-[#8b9589]">no preview content</div>
      )}
      {remaining > 0 ? <div className="mt-2 text-[#8b9589]">... ({remaining} more lines)</div> : null}
    </div>
  );
}

interface ToolSummary {
  prefix: string;
  path?: string;
  suffix?: string;
  range?: string;
  diff?: string;
}

function buildToolSummary(tool: PiToolCall): ToolSummary {
  if (tool.name === "read") {
    const path = getStringArg(tool, "path") ?? getStringArg(tool, "file_path") ?? tool.target;
    const { start, end } = getReadRange(tool);
    const range = start ? `${start}${end && end !== start ? `-${end}` : ""}` : undefined;
    return { prefix: "", path, range, suffix: range ? `:${range}` : "" };
  }

  if (tool.name === "edit") {
    const path = getStringArg(tool, "path") ?? getStringArg(tool, "file_path") ?? tool.target;
    const diff = getStringDetail(tool, "diff") ?? buildDiffFromArgs(tool);
    return { prefix: "AI edited ", path, suffix: diff ? "" : ` · ${tool.summary}`, diff };
  }

  if (tool.name === "write") {
    const path = getStringArg(tool, "path") ?? getStringArg(tool, "file_path") ?? parseWritePath(tool.output) ?? tool.target;
    return { prefix: "AI wrote ", path };
  }

  if (tool.name === "bash") {
    const command = getStringArg(tool, "command") ?? tool.target;
    return { prefix: "AI ran ", path: command };
  }

  return { prefix: "AI used ", path: tool.target || tool.name, suffix: tool.summary ? ` · ${tool.summary}` : "" };
}

function getReadRange(tool: PiToolCall): { start?: number; end?: number } {
  const offset = getNumberArg(tool, "offset");
  const limit = getNumberArg(tool, "limit");
  if (offset !== undefined && limit !== undefined) return { start: offset, end: offset + limit - 1 };
  if (offset !== undefined) return { start: offset };
  const output = tool.output ?? "";
  const showing = output.match(/\[Showing lines (\d+)-(\d+) of (\d+)/i);
  if (showing?.[1] && showing?.[2]) return { start: Number(showing[1]), end: Number(showing[2]) };
  const continuation = output.match(/\[.*?more lines in file\. Use offset=(\d+) to continue/i);
  if (continuation?.[1]) return { start: 1, end: Math.max(1, Number(continuation[1]) - 1) };
  const lineCount = output ? output.split(/\r?\n/).length : undefined;
  return lineCount ? { start: 1, end: lineCount } : {};
}

function buildDiffFromArgs(tool: PiToolCall): string | undefined {
  const edits = tool.args?.edits;
  if (!Array.isArray(edits)) return undefined;
  const chunks = edits.flatMap((edit, index) => {
    if (!edit || typeof edit !== "object") return [];
    const item = edit as Record<string, unknown>;
    const oldText = typeof item.oldText === "string" ? item.oldText : undefined;
    const newText = typeof item.newText === "string" ? item.newText : undefined;
    if (oldText === undefined || newText === undefined) return [];
    return [`@@ edit ${index + 1} @@`, ...oldText.split(/\r?\n/).map((line) => `-${line}`), ...newText.split(/\r?\n/).map((line) => `+${line}`)];
  });
  return chunks.length ? chunks.join("\n") : undefined;
}

function DiffPreview({ diff }: { diff?: string }) {
  if (!diff) return null;
  const lines = diff.split(/\r?\n/).slice(0, 160);
  return (
    <div className="border-t border-border bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5">
      {lines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          className={cn(
            "whitespace-pre-wrap break-words px-2",
            line.startsWith("+") && !line.startsWith("+++") && "bg-success/10 text-success",
            line.startsWith("-") && !line.startsWith("---") && "bg-danger/10 text-danger",
            line.startsWith("@@") && "bg-primary/10 text-primary",
            (line.startsWith("+++") || line.startsWith("---")) && "text-muted-foreground",
          )}
        >
          {line || " "}
        </div>
      ))}
      {diff.split(/\r?\n/).length > lines.length ? <div className="px-2 text-muted-foreground">… diff truncated in preview</div> : null}
    </div>
  );
}

function stripReadContinuation(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  const trimmed = lines.slice(0, end);
  const noticeIndex = trimmed.findIndex((line) => /^\[.*?(more lines in file|Showing lines).*?\]$/i.test(line.trim()));
  return noticeIndex >= 0 ? trimmed.slice(0, noticeIndex) : trimmed;
}

function parseWritePath(output?: string): string | undefined {
  const match = output?.match(/Successfully wrote \d+ bytes to (.+)$/m);
  return match?.[1]?.trim();
}

function getStringArg(tool: PiToolCall, key: string): string | undefined {
  const value = tool.args?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumberArg(tool: PiToolCall, key: string): number | undefined {
  const value = tool.args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringDetail(tool: PiToolCall, key: string): string | undefined {
  const value = tool.details?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
