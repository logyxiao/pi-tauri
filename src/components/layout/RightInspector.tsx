import { Activity, FileCode2, GitFork, HardDrive, Terminal } from "lucide-react";
import { ExtensionsPanel } from "@/components/extensions/ExtensionsPanel";
import { ToolResultPanel } from "@/components/tools/ToolResultPanel";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiMessage,
  PiSessionStats,
  PiSettings,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

interface RightInspectorProps {
  selectedTool: PiToolCall | null;
  messages: PiMessage[];
  state: PiState | null;
  stats: PiSessionStats | null;
  settings: PiSettings | null;
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionMessages: PiExtensionMessage[];
  extensionErrors: PiExtensionError[];
}

export function RightInspector({
  selectedTool,
  messages,
  state,
  stats,
  settings,
  commands,
  extensionPanels,
  extensionMessages,
  extensionErrors,
}: RightInspectorProps) {
  const activeTools = messages.flatMap((message) => message.tools ?? []).slice(-6).reverse();

  const stateCards = [
    ["Tokens", (stats?.totalTokens ?? state?.tokenCount ?? 0).toLocaleString()],
    ["Cost", `$${(stats?.costUsd ?? state?.costUsd ?? 0).toFixed(4)}`],
    ["Run", state?.runState ?? "loading"],
    ["Thinking", state?.thinkingLevel ?? "off"],
    ["Client", settings?.clientMode ?? "loading"],
  ];

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface xl:flex">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} className="text-primary" /> Inspector
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Tools, files, sessions, extensions</p>
      </div>

      <div className="space-y-4 overflow-auto p-4">
        {extensionErrors.length ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
            Extension error visible: {extensionErrors[0].message}
          </div>
        ) : null}

        {selectedTool ? (
          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              <Terminal size={14} /> Selected tool
            </div>
            <ToolResultPanel tool={selectedTool} />
          </section>
        ) : null}

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <HardDrive size={14} /> State
          </div>
          <div className="grid grid-cols-2 gap-2">
            {stateCards.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface p-3">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>Session</span>
              <span className="truncate font-mono text-foreground">{state?.sessionName ?? state?.sessionId ?? "unknown"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Messages</span>
              <span className="font-mono text-foreground">{stats?.totalMessages ?? 0}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Tools</span>
              <span className="font-mono text-foreground">{stats?.toolCalls ?? 0}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Model</span>
              <span className="truncate font-mono text-foreground">{settings?.model ?? state?.model ?? "unknown"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Context</span>
              <span className="font-mono text-foreground">
                {stats?.contextPercent == null ? "n/a" : `${stats.contextPercent.toFixed(1)}%`}
              </span>
            </div>
            <div className="truncate font-mono text-[11px]" title={state?.sessionFile ?? stats?.sessionFile}>
              {state?.sessionFile ?? stats?.sessionFile ?? "no session file"}
            </div>
          </div>
        </section>

        <ExtensionsPanel
          commands={commands}
          extensionPanels={extensionPanels}
          extensionMessages={extensionMessages}
          extensionErrors={extensionErrors}
        />

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Terminal size={14} /> Active tools
          </div>
          <div className="space-y-2">
            {activeTools.length ? (
              activeTools.map((tool) => (
                <div key={tool.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{tool.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tool.status}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{tool.target}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{tool.summary}</div>
                </div>
              ))
            ) : (
              <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">No active tools yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <GitFork size={14} /> Session tree
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="rounded-xl bg-surface p-3">root → design summary → project init</div>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">current leaf: app shell</div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <FileCode2 size={14} /> Preview
          </div>
          <div className="rounded-xl bg-surface p-3 font-mono text-xs leading-5 text-muted-foreground">
            src/components/layout/AppShell.tsx
          </div>
        </section>
      </div>
    </aside>
  );
}
