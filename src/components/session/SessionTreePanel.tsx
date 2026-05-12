import { GitBranch, GitFork, GitPullRequest, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";
import type { PiForkMessage, PiSessionTree, PiSessionTreeNode } from "@/shared/pi/types";

interface SessionTreePanelProps {
  tree: PiSessionTree | null;
  forkMessages: PiForkMessage[];
  onForkSession: (entryId: string) => Promise<void> | void;
  onCloneSession: () => Promise<void> | void;
  onSetLabel: (entryId: string, label?: string) => Promise<void> | void;
}

export function SessionTreePanel({ tree, forkMessages, onForkSession, onCloneSession, onSetLabel }: SessionTreePanelProps) {
  const nodes = tree?.nodes ?? [];
  const forkableIds = new Set(forkMessages.map((message) => message.entryId));
  const branchPath = activeBranchPath(nodes, tree?.activeLeafId);

  async function editLabel(node: PiSessionTreeNode) {
    const label = window.prompt("Entry label", node.label ?? "");
    if (label == null) return;
    await onSetLabel(node.id, label.trim() || undefined);
  }

  return (
    <section className="rounded-2xl border border-border bg-background/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <GitBranch size={14} /> Session tree
        </div>
        <Button size="sm" variant="ghost" onClick={() => void onCloneSession()}>
          <GitPullRequest size={12} /> Clone
        </Button>
      </div>

      {branchPath.length ? (
        <div className="mb-3 rounded-xl border border-border bg-surface p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Active branch</div>
          <div className="space-y-1">
            {branchPath.slice(-4).map((node) => (
              <div key={node.id} className="truncate text-xs text-muted-foreground">
                {node.role ?? node.type}: <span className="text-foreground">{node.title}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[28rem] space-y-1 overflow-auto pr-1">
        {nodes.length ? (
          nodes.map((node) => {
            const active = node.id === tree?.activeLeafId;
            const canFork = node.role === "user" || forkableIds.has(node.id);
            return (
              <div
                key={node.id}
                className={cn(
                  "group rounded-xl border bg-surface/70 px-2 py-1.5 transition",
                  active ? "border-primary/40 shadow-[inset_2px_0_0_var(--primary)]" : "border-transparent hover:border-border",
                )}
                style={{ marginLeft: Math.min(node.depth, 6) * 10 }}
              >
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1 size-1.5 rounded-full", active ? "bg-primary" : "bg-muted-foreground/40")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                        {node.role ?? node.type}
                      </span>
                      {node.label ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-1.5 py-0.5 text-[9px] text-primary">
                          <Tag size={9} /> {node.label}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground">{node.title}</div>
                    {node.summary ? <div className="mt-1 line-clamp-3 text-[11px] leading-4 text-muted-foreground">{node.summary}</div> : null}
                    <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                      <span>{node.childrenCount} children</span>
                      {node.timestamp ? <span className="truncate">{node.timestamp}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    {canFork ? (
                      <Button size="icon" variant="ghost" aria-label="Fork from entry" onClick={() => void onForkSession(node.id)}>
                        <GitFork size={11} />
                      </Button>
                    ) : null}
                    <Button size="icon" variant="ghost" aria-label="Set label" onClick={() => void editLabel(node)}>
                      <Tag size={11} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">No session tree available.</div>
        )}
      </div>
    </section>
  );
}

function activeBranchPath(nodes: PiSessionTreeNode[], activeLeafId?: string): PiSessionTreeNode[] {
  if (!activeLeafId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: PiSessionTreeNode[] = [];
  let cursor = byId.get(activeLeafId);
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}
