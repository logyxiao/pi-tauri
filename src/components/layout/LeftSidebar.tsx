import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  Folder,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import type { PiSessionSummary } from "@/shared/pi/types";

interface LeftSidebarProps {
  collapsed: boolean;
  sessions: PiSessionSummary[];
  openedWorkspaceCount: number;
  currentSessionId?: string;
  onToggle: () => void;
  onNewSession: () => void;
  onContinueRecent: () => Promise<void> | void;
  onOpenWorkspaceFolder: () => Promise<void> | void;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
  onSetSessionName: (name: string) => Promise<void> | void;
  onDeleteSession: (sessionPath: string) => Promise<void> | void;
  onExportHtml: () => Promise<string | null> | string | null;
  onOpenSettings: () => void;
}

interface ProjectSessionGroup {
  cwd: string;
  label: string;
  sessions: PiSessionSummary[];
  latestUpdatedAt: string;
}

export function LeftSidebar({
  collapsed,
  sessions,
  openedWorkspaceCount,
  currentSessionId,
  onToggle,
  onNewSession,
  onContinueRecent,
  onOpenWorkspaceFolder,
  onSwitchSession,
  onSetSessionName,
  onDeleteSession,
  onExportHtml,
  onOpenSettings,
}: LeftSidebarProps) {
  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions]);
  const selectedGroup = groups.find((group) => group.sessions.some((session) => isSelectedSession(session, currentSessionId)));
  const [closedProjects, setClosedProjects] = useState<Set<string>>(() => new Set());

  async function renameCurrentSession() {
    const current = sessions.find((session) => session.id === currentSessionId) ?? sessions[0];
    const name = window.prompt("Session name", current?.name ?? "");
    if (name == null) return;
    await onSetSessionName(name);
  }

  async function deleteSession(session: PiSessionSummary) {
    if (!session.filePath) return;
    const confirmed = window.confirm(`Delete session file?\n\n${session.name}\n${session.filePath}`);
    if (!confirmed) return;
    await onDeleteSession(session.filePath);
  }

  function toggleProject(cwd: string) {
    setClosedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-sidebar/70 transition-[width] duration-200 backdrop-blur-[1px]",
        collapsed ? "w-[4.5rem]" : "w-72",
      )}
    >
      <div className={cn("flex items-center p-4", collapsed ? "justify-center" : "justify-between")}>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-primary/45 bg-transparent text-primary shadow-[inset_2px_0_0_var(--primary)]">
            <Sparkles size={18} />
          </div>
          {!collapsed ? (
            <div>
              <div className="text-sm font-semibold">Pi Desktop</div>
              <div className="text-xs text-muted-foreground">projects, sessions, tools</div>
            </div>
          ) : null}
        </div>
        {!collapsed ? (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Toggle sidebar" onClick={onToggle}>
              <PanelLeftClose size={17} />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Settings" onClick={onOpenSettings}>
              <Settings size={17} />
            </Button>
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="primary" aria-label="New session" onClick={onNewSession}>
                <Plus size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New session</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Settings" onClick={onOpenSettings}>
                <Settings size={17} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Expand sidebar" onClick={onToggle}>
                <PanelLeftOpen size={17} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-4 pb-3">
            <Button className="w-full justify-start" variant="primary" onClick={onNewSession}>
              <Plus size={16} /> New session
            </Button>
            <div className="grid grid-cols-3 gap-1">
              <Button size="sm" variant="ghost" onClick={() => void onContinueRecent()}>
                Recent
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void renameCurrentSession()}>
                <Pencil size={13} /> Name
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const path = await onExportHtml();
                  if (path) console.info("pi session exported", path);
                }}
              >
                <Download size={13} /> HTML
              </Button>
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface/70 px-3 font-mono text-muted-foreground">
              <Search size={15} />
              <span className="text-xs">Search projects, sessions...</span>
            </div>
          </div>
        </>
      )}

      <div className="flex-1 overflow-auto px-3 pb-3">
        {!collapsed ? (
          <div className="mb-2 flex items-center justify-between gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Workspaces</span>
            <div className="flex items-center gap-2">
              <button className="font-mono text-[10px] normal-case tracking-normal text-primary hover:underline" onClick={() => void onOpenWorkspaceFolder()}>
                Open folder
              </button>
              <span title={`${openedWorkspaceCount} opened folders`}>{groups.length}</span>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          {groups.length ? (
            groups.map((group) => {
              const selectedProject = group.cwd === selectedGroup?.cwd;
              const open = selectedProject || !closedProjects.has(group.cwd);
              return collapsed ? (
                <CollapsedProjectGroup key={group.cwd} group={group} currentSessionId={currentSessionId} onSwitchSession={onSwitchSession} />
              ) : (
                <div
                  key={group.cwd}
                  className={cn(
                    "rounded-md border transition",
                    selectedProject ? "border-primary/35 bg-surface/70" : "border-transparent hover:border-border hover:bg-surface/50",
                  )}
                >
                  <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => toggleProject(group.cwd)}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Folder size={15} className={selectedProject ? "text-primary" : "text-muted-foreground"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{group.label}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground" title={group.cwd}>
                        {group.cwd}
                      </div>
                    </div>
                    <div className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {group.sessions.length}
                    </div>
                  </button>
                  {open ? (
                    <div className="space-y-0.5 border-t border-border/70 p-1 pl-5">
                      {group.sessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          selected={isSelectedSession(session, currentSessionId)}
                          onSwitchSession={onSwitchSession}
                          onDeleteSession={deleteSession}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className={collapsed ? "px-0" : "rounded-md border border-border bg-surface/70 p-3 text-xs text-muted-foreground"}>
              {!collapsed ? "No saved sessions for opened workspace." : null}
            </div>
          )}
        </div>
      </div>

      {!collapsed ? (
        <div className="border-t border-border p-3">
          <Button className="w-full justify-start" variant="ghost">
            <GitFork size={16} /> Session tree
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onSwitchSession,
  onDeleteSession,
}: {
  session: PiSessionSummary;
  selected: boolean;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
  onDeleteSession: (session: PiSessionSummary) => Promise<void> | void;
}) {
  const switchTarget = session.filePath ?? session.id;
  return (
    <div
      className={cn(
        "group rounded-md border transition",
        selected ? "border-primary/45 bg-card shadow-[inset_2px_0_0_var(--primary)]" : "border-transparent hover:border-border hover:bg-card/80",
      )}
    >
      <div className="flex items-center gap-1.5 pr-1">
        <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => void onSwitchSession(switchTarget)}>
          <div className="flex items-center gap-1.5">
            <CircleDot size={10} className={session.status === "running" ? "text-primary" : "text-muted-foreground"} />
            <span className="truncate text-xs font-medium leading-snug">{session.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 pl-[18px] font-mono text-[10px] text-muted-foreground">
            <span className="truncate">{session.updatedAt}</span>
            <span>{session.messageCount ?? 0} msgs</span>
          </div>
        </button>
        {session.filePath ? (
          <Button
            className="opacity-0 transition group-hover:opacity-100"
            size="icon"
            variant="ghost"
            aria-label={`Delete ${session.name}`}
            onClick={() => void onDeleteSession(session)}
          >
            <Trash2 size={12} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CollapsedProjectGroup({
  group,
  currentSessionId,
  onSwitchSession,
}: {
  group: ProjectSessionGroup;
  currentSessionId?: string;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
}) {
  const selected = group.sessions.some((session) => isSelectedSession(session, currentSessionId));
  const latestSession = group.sessions[0];
  const switchTarget = latestSession?.filePath ?? latestSession?.id;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            "flex size-11 items-center justify-center rounded-md border transition",
            selected ? "border-primary/45 bg-surface/70 shadow-[inset_2px_0_0_var(--primary)]" : "border-transparent hover:bg-surface/70",
          )}
          disabled={!switchTarget}
          onClick={() => switchTarget && void onSwitchSession(switchTarget)}
        >
          <Folder size={16} className={selected ? "text-primary" : "text-muted-foreground"} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {group.label} · {group.sessions.length} sessions
      </TooltipContent>
    </Tooltip>
  );
}

function groupSessionsByProject(sessions: PiSessionSummary[]): ProjectSessionGroup[] {
  const map = new Map<string, PiSessionSummary[]>();
  for (const session of sessions) {
    const cwd = normalizeProjectPath(session.cwd || "Unknown project");
    map.set(cwd, [...(map.get(cwd) ?? []), session]);
  }

  return Array.from(map.entries())
    .map(([cwd, projectSessions]) => {
      const sorted = [...projectSessions].sort((left, right) => compareUpdatedAt(right.updatedAt, left.updatedAt));
      return {
        cwd,
        label: projectLabel(cwd),
        sessions: sorted,
        latestUpdatedAt: sorted[0]?.updatedAt ?? "unknown",
      };
    })
    .sort((left, right) => compareUpdatedAt(right.latestUpdatedAt, left.latestUpdatedAt));
}

function isSelectedSession(session: PiSessionSummary, currentSessionId?: string): boolean {
  return Boolean(currentSessionId && (session.id === currentSessionId || session.filePath === currentSessionId));
}

function normalizeProjectPath(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/$/, "");
}

function projectLabel(cwd: string): string {
  const normalized = normalizeProjectPath(cwd);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function compareUpdatedAt(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right);
}
