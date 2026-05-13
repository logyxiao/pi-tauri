import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Folder,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import type { PiSessionSummary } from "@/shared/pi/types";

interface LeftSidebarProps {
  collapsed: boolean;
  sessions: PiSessionSummary[];
  openedWorkspacePaths: string[];
  currentSessionId?: string;
  onToggle: () => void;
  onOpenWorkspaceFolder: () => Promise<void> | void;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
  onDeleteSession: (sessionPath: string) => Promise<void> | void;
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
  openedWorkspacePaths,
  currentSessionId,
  onToggle,
  onOpenWorkspaceFolder,
  onSwitchSession,
  onDeleteSession,
  onOpenSettings,
}: LeftSidebarProps) {
  const { t } = useI18n();
  const groups = useMemo(() => groupSessionsByProject(sessions, openedWorkspacePaths), [sessions, openedWorkspacePaths]);
  const selectedGroup = groups.find((group) => group.sessions.some((session) => isSelectedSession(session, currentSessionId)));
  const [closedProjects, setClosedProjects] = useState<Set<string>>(() => new Set());

  async function deleteSession(session: PiSessionSummary) {
    if (!session.filePath) return;
    const confirmed = window.confirm(`${t("sidebar.deleteConfirm")}\n\n${session.name}\n${session.filePath}`);
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
      <div className={cn("flex items-center border-b border-border/70 p-3", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("sidebar.workspaces")}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {openedWorkspacePaths.length ? `${openedWorkspacePaths.length} ${t("sidebar.opened")}` : t("sidebar.currentWorkspace")}
            </div>
          </div>
        ) : null}
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "gap-1")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("sidebar.openWorkspace")} onClick={() => void onOpenWorkspaceFolder()}>
                <FolderPlus size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.openFolder")}</TooltipContent>
          </Tooltip>
          {!collapsed ? (
            <>
              <Button size="icon" variant="ghost" aria-label={t("sidebar.settings")} onClick={onOpenSettings}>
                <Settings size={16} />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t("sidebar.collapse")} onClick={onToggle}>
                <PanelLeftClose size={16} />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {collapsed ? (
        <div className="mt-2 flex flex-col items-center gap-2 px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("sidebar.settings")} onClick={onOpenSettings}>
                <Settings size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.settings")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("sidebar.expand")} onClick={onToggle}>
                <PanelLeftOpen size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.expand")}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-2 py-2">
        {!collapsed ? (
          <div className="mb-2 flex items-center justify-between px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{t("sidebar.folders")}</span>
            <span title={`${openedWorkspacePaths.length} ${t("sidebar.openedFolders")}`}>{groups.length}</span>
          </div>
        ) : null}
        <div className="space-y-1">
          {groups.length ? (
            groups.map((group) => {
              const selectedProject = group.cwd === selectedGroup?.cwd;
              const open = selectedProject || !closedProjects.has(group.cwd);
              return collapsed ? (
                <CollapsedProjectGroup key={group.cwd} group={group} currentSessionId={currentSessionId} onSwitchSession={onSwitchSession} sessionsLabel={t("sidebar.sessions")} />
              ) : (
                <div
                  key={group.cwd}
                  className={cn(
                    "rounded-lg border transition",
                    selectedProject ? "border-primary/30 bg-surface/70" : "border-transparent hover:border-border hover:bg-surface/45",
                  )}
                >
                  <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => toggleProject(group.cwd)}>
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <Folder size={14} className={selectedProject ? "text-primary" : "text-muted-foreground"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{group.label}</div>
                      <div className="truncate font-mono text-[9px] text-muted-foreground" title={group.cwd}>
                        {group.cwd}
                      </div>
                    </div>
                    <div className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {group.sessions.length}
                    </div>
                  </button>
                  {open ? (
                    <div className="space-y-0.5 border-t border-border/60 p-1 pl-5">
                      {group.sessions.length ? (
                        group.sessions.map((session) => (
                          <SessionRow
                            key={session.id}
                            session={session}
                            selected={isSelectedSession(session, currentSessionId)}
                            onSwitchSession={onSwitchSession}
                            onDeleteSession={deleteSession}
                            messagesLabel={t("sidebar.messagesShort")}
                            deleteLabel={t("sidebar.deleteAria", { name: session.name })}
                          />
                        ))
                      ) : (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("sidebar.noSessions")}</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className={collapsed ? "px-0" : "rounded-lg border border-border bg-surface/60 p-3 text-xs text-muted-foreground"}>
              {!collapsed ? t("sidebar.openFolderEmpty") : null}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onSwitchSession,
  onDeleteSession,
  messagesLabel,
  deleteLabel,
}: {
  session: PiSessionSummary;
  selected: boolean;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
  onDeleteSession: (session: PiSessionSummary) => Promise<void> | void;
  messagesLabel: string;
  deleteLabel: string;
}) {
  const switchTarget = session.filePath ?? session.id;
  return (
    <div
      className={cn(
        "group rounded-md border transition",
        selected ? "border-primary/35 bg-card shadow-[inset_2px_0_0_var(--primary)]" : "border-transparent hover:border-border hover:bg-card/80",
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => void onSwitchSession(switchTarget)}>
          <div className="flex items-center gap-1.5">
            <CircleDot size={9} className={session.status === "running" ? "text-primary" : "text-muted-foreground"} />
            <span className="truncate text-xs font-medium leading-snug">{session.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 pl-[17px] font-mono text-[9px] text-muted-foreground">
            <span className="truncate">{session.updatedAt}</span>
            <span>{session.messageCount ?? 0} {messagesLabel}</span>
          </div>
        </button>
        {session.filePath ? (
          <Button
            className="size-7 opacity-0 transition group-hover:opacity-100"
            size="icon"
            variant="ghost"
            aria-label={deleteLabel}
            onClick={() => void onDeleteSession(session)}
          >
            <Trash2 size={11} />
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
  sessionsLabel,
}: {
  group: ProjectSessionGroup;
  currentSessionId?: string;
  onSwitchSession: (sessionPath: string) => Promise<void> | void;
  sessionsLabel: string;
}) {
  const selected = group.sessions.some((session) => isSelectedSession(session, currentSessionId));
  const latestSession = group.sessions[0];
  const switchTarget = latestSession?.filePath ?? latestSession?.id;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            "flex size-10 items-center justify-center rounded-md border transition",
            selected ? "border-primary/45 bg-surface/70 shadow-[inset_2px_0_0_var(--primary)]" : "border-transparent hover:bg-surface/70",
          )}
          disabled={!switchTarget}
          onClick={() => switchTarget && void onSwitchSession(switchTarget)}
        >
          <Folder size={15} className={selected ? "text-primary" : "text-muted-foreground"} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {group.label} · {group.sessions.length} {sessionsLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function groupSessionsByProject(sessions: PiSessionSummary[], openedWorkspacePaths: string[]): ProjectSessionGroup[] {
  const map = new Map<string, PiSessionSummary[]>();
  for (const cwd of openedWorkspacePaths) {
    map.set(normalizeProjectPath(cwd), []);
  }
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
