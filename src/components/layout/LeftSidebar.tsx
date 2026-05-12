import { CircleDot, GitFork, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sparkles } from "lucide-react";
import { demoSessions } from "@/shared/pi/mock-data";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";

interface LeftSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export function LeftSidebar({ collapsed, onToggle, onNewSession, onOpenSettings }: LeftSidebarProps) {
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
              <div className="text-xs text-muted-foreground">coding agent workbench</div>
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
          <div className="px-4 pb-3">
            <Button className="w-full justify-start" variant="primary" onClick={onNewSession}>
              <Plus size={16} /> New session
            </Button>
          </div>

          <div className="px-4 pb-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface/70 px-3 font-mono text-muted-foreground">
              <Search size={15} />
              <span className="text-xs">Search sessions, projects...</span>
            </div>
          </div>
        </>
      )}

      <div className="flex-1 overflow-auto px-3 pb-3">
        {!collapsed ? (
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sessions
          </div>
        ) : null}
        <div className="space-y-1.5">
          {demoSessions.map((session, index) =>
            collapsed ? (
              <Tooltip key={session.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex size-11 items-center justify-center rounded-md border transition",
                      index === 0
                        ? "border-primary/45 bg-surface/70 shadow-[inset_2px_0_0_var(--primary)]"
                        : "border-transparent hover:bg-surface/70",
                    )}
                  >
                    <CircleDot size={16} className={session.status === "running" ? "text-primary" : "text-muted-foreground"} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{session.name}</TooltipContent>
              </Tooltip>
            ) : (
              <button
                key={session.id}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition",
                  index === 0
                    ? "border-primary/45 bg-surface/70 shadow-[inset_2px_0_0_var(--primary)]"
                    : "border-transparent hover:border-border hover:bg-surface/70",
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">{session.name}</div>
                  <CircleDot
                    size={13}
                    className={session.status === "running" ? "mt-0.5 text-primary" : "mt-0.5 text-muted-foreground"}
                  />
                </div>
                <div className="truncate text-xs text-muted-foreground">{session.cwd}</div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{session.model}</span>
                  <span>{session.updatedAt}</span>
                </div>
              </button>
            ),
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
