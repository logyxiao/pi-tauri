import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Folder,
  FolderPlus,
  MessageSquarePlus,
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
  onNewSession: () => Promise<void> | void;
  onOpenSettings: () => void;
}

interface ProjectSessionGroup {
  cwd: string;
  label: string;
  sessions: PiSessionSummary[];
  latestUpdatedAt: string;
  latestUpdatedAtMs?: number;
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
  onNewSession,
  onOpenSettings,
}: LeftSidebarProps) {
  const { t } = useI18n();
  const groups = useMemo(() => groupSessionsByProject(sessions, openedWorkspacePaths), [sessions, openedWorkspacePaths]);
  const selectedGroup = groups.find((group) => group.sessions.some((session) => isSelectedSession(session, currentSessionId)));
  const [closedProjects, setClosedProjects] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiSessionSummary | null>(null);

  function showNotice(kind: "success" | "error", text: string) {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 1800);
  }

  async function deleteSession(session: PiSessionSummary) {
    if (!session.filePath) return;
    setDeleteTarget(session);
  }

  async function confirmDeleteTarget() {
    if (!deleteTarget?.filePath) return;
    const sessionPath = deleteTarget.filePath;
    setDeleteTarget(null);
    try {
      await onDeleteSession(sessionPath);
      showNotice("success", t("sidebar.deleteSuccess"));
    } catch {
      showNotice("error", t("sidebar.deleteFailed"));
    }
  }

  function toggleProject(cwd: string) {
    setClosedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (collapsed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    function move(pointerEvent: PointerEvent) {
      const nextWidth = Math.min(Math.max(startWidth + pointerEvent.clientX - startX, 220), 420);
      setSidebarWidth(nextWidth);
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col border-r border-border bg-sidebar/70 backdrop-blur-[1px]",
        collapsed ? "w-[4.5rem] transition-[width] duration-200" : "",
      )}
      style={collapsed ? undefined : { width: sidebarWidth }}
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
              <Button className="cursor-pointer" size="icon" variant="ghost" aria-label={t("sidebar.openWorkspace")} onClick={() => void onOpenWorkspaceFolder()}>
                <FolderPlus size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.openFolder")}</TooltipContent>
          </Tooltip>
          {!collapsed ? (
            <>
              <Button className="cursor-pointer" size="icon" variant="ghost" aria-label={t("sidebar.settings")} onClick={onOpenSettings}>
                <Settings size={16} />
              </Button>
              <Button className="cursor-pointer" size="icon" variant="ghost" aria-label={t("sidebar.collapse")} onClick={onToggle}>
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
              <Button className="cursor-pointer" size="icon" variant="ghost" aria-label={t("sidebar.settings")} onClick={onOpenSettings}>
                <Settings size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.settings")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="cursor-pointer" size="icon" variant="ghost" aria-label={t("sidebar.expand")} onClick={onToggle}>
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
              const open = !closedProjects.has(group.cwd);
              return collapsed ? (
                <CollapsedProjectGroup key={group.cwd} group={group} currentSessionId={currentSessionId} onSwitchSession={onSwitchSession} />
              ) : (
                <div
                  key={group.cwd}
                  className={cn(
                    "rounded-none border transition",
                    selectedProject ? "border-primary/30 bg-surface/70" : "border-transparent hover:border-border hover:bg-surface/45",
                  )}
                >
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => toggleProject(group.cwd)}>
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Folder size={14} className={selectedProject ? "text-primary" : "text-muted-foreground"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{group.label}</div>
                        <div className="truncate font-mono text-[9px] text-muted-foreground" title={group.cwd}>
                          {group.cwd}
                        </div>
                      </div>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="size-7 shrink-0 cursor-pointer text-muted-foreground transition hover:bg-transparent hover:text-primary"
                          size="icon"
                          variant="ghost"
                          aria-label={t("sidebar.newSession")}
                          onClick={() => void onNewSession()}
                        >
                          <MessageSquarePlus size={13} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("sidebar.newSession")}</TooltipContent>
                    </Tooltip>
                  </div>
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
            <div className={collapsed ? "px-0" : "rounded-none border border-border bg-surface/60 p-3 text-xs text-muted-foreground"}>
              {!collapsed ? t("sidebar.openFolderEmpty") : null}
            </div>
          )}
        </div>
      </div>
      {deleteTarget && !collapsed ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-[18rem] border border-border bg-popover p-3 text-xs shadow-xl">
            <div className="font-semibold text-foreground">{t("sidebar.deleteConfirm")}</div>
            <div className="mt-2 truncate font-medium text-foreground">{deleteTarget.name}</div>
            <div className="mt-1 break-all font-mono text-[9px] text-muted-foreground">{deleteTarget.filePath}</div>
            <div className="mt-3 flex justify-end gap-2">
              <Button className="cursor-pointer" size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
              <Button className="cursor-pointer" size="sm" variant="destructive" onClick={() => void confirmDeleteTarget()}>{t("command.confirm")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {notice && !collapsed ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-3 left-3 right-4 z-20 border px-3 py-2 text-xs shadow-lg backdrop-blur",
            notice.kind === "success" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {notice.text}
        </div>
      ) : null}
      {!collapsed ? (
        <div
          className="absolute right-[-3px] top-0 h-full w-1.5 cursor-col-resize bg-transparent transition hover:bg-primary/25"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
        />
      ) : null}
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
        "group rounded-none border transition",
        selected ? "border-primary bg-primary/12 shadow-[inset_3px_0_0_var(--primary),0_8px_24px_rgb(44_54_70/0.08)]" : "border-transparent hover:border-border hover:bg-card/80",
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <button className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-left" onClick={() => void onSwitchSession(switchTarget)}>
          <div className="flex items-center gap-1.5">
            <CircleDot size={9} className={selected || session.status === "running" ? "text-primary" : "text-muted-foreground"} />
            <span className={cn("truncate text-xs font-medium leading-snug", selected && "font-semibold text-primary")}>{session.name}</span>
          </div>
          <div className={cn("mt-0.5 flex items-center gap-2 pl-[17px] font-mono text-[9px]", selected ? "text-primary/75" : "text-muted-foreground")}>
            <span className="truncate">{session.updatedAt}</span>
            <span>{session.messageCount ?? 0} {messagesLabel}</span>
          </div>
        </button>
        {session.filePath ? (
          <Button
            className="size-7 cursor-pointer opacity-0 transition group-hover:opacity-100"
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
            "flex size-10 cursor-pointer items-center justify-center rounded-none border transition",
            selected ? "border-primary/45 bg-surface/70" : "border-transparent hover:bg-surface/70",
          )}
          disabled={!switchTarget}
          onClick={() => switchTarget && void onSwitchSession(switchTarget)}
        >
          <Folder size={15} className={selected ? "text-primary" : "text-muted-foreground"} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{group.label}</TooltipContent>
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
      const sorted = [...projectSessions].sort(compareSessionUpdatedDesc);
      return {
        cwd,
        label: projectLabel(cwd),
        sessions: sorted,
        latestUpdatedAt: sorted[0]?.updatedAt ?? "unknown",
        latestUpdatedAtMs: sorted[0] ? getSessionSortTime(sorted[0]) : undefined,
      };
    })
    .sort((left, right) => {
      if (Number.isFinite(left.latestUpdatedAtMs) && Number.isFinite(right.latestUpdatedAtMs)) return (right.latestUpdatedAtMs ?? 0) - (left.latestUpdatedAtMs ?? 0);
      return compareUpdatedAt(right.latestUpdatedAt, left.latestUpdatedAt);
    });
}

function isSelectedSession(session: PiSessionSummary, currentSessionId?: string): boolean {
  if (!currentSessionId) return false;
  return session.id === currentSessionId || session.filePath === currentSessionId || normalizeProjectPath(session.filePath ?? "") === normalizeProjectPath(currentSessionId);
}

function normalizeProjectPath(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/$/, "");
}

function projectLabel(cwd: string): string {
  const normalized = normalizeProjectPath(cwd);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function compareSessionUpdatedDesc(left: PiSessionSummary, right: PiSessionSummary): number {
  const leftTime = getSessionSortTime(left);
  const rightTime = getSessionSortTime(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
  if (Number.isFinite(leftTime)) return -1;
  if (Number.isFinite(rightTime)) return 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareUpdatedAt(left: string, right: string): number {
  const leftTime = parseDisplayedUpdatedAt(left);
  const rightTime = parseDisplayedUpdatedAt(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right);
}

function getSessionSortTime(session: PiSessionSummary): number {
  if (typeof session.updatedAtMs === "number") return session.updatedAtMs;
  return parseDisplayedUpdatedAt(session.updatedAt);
}

function parseDisplayedUpdatedAt(value: string): number {
  if (value === "current") return Date.now();
  if (value.startsWith("unix-ms:")) return Number(value.slice("unix-ms:".length));
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;

  const todayTime = parseClockTime(value);
  if (todayTime !== null) return todayTime;

  const yesterdayPrefix = "Yesterday ";
  if (value.startsWith(yesterdayPrefix)) {
    const yesterdayTime = parseClockTime(value.slice(yesterdayPrefix.length));
    if (yesterdayTime !== null) return yesterdayTime - 24 * 60 * 60 * 1000;
  }

  return Number.NaN;
}

function parseClockTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}
