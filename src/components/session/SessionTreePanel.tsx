import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, GitBranch, GitFork, GitPullRequest, Info, Tag } from "lucide-react";
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

type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

const filterModes: TreeFilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];

export function SessionTreePanel({ tree, forkMessages, onForkSession, onCloneSession, onSetLabel }: SessionTreePanelProps) {
  const nodes = tree?.nodes ?? [];
  const [filterMode, setFilterMode] = useState<TreeFilterMode>("default");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const forkableIds = new Set(forkMessages.map((message) => message.entryId));
  const forkMessagesById = new Map(forkMessages.map((message) => [message.entryId, message]));
  const branchPath = useMemo(() => activeBranchPath(nodes, tree?.activeLeafId), [nodes, tree?.activeLeafId]);
  const branchIds = useMemo(() => new Set(branchPath.map((node) => node.id)), [branchPath]);
  const visibleNodes = useMemo(() => filterVisibleNodes(nodes, filterMode, collapsedIds), [nodes, filterMode, collapsedIds]);

  async function editLabel(node: PiSessionTreeNode) {
    const label = window.prompt("Entry label", node.label ?? "");
    if (label == null) return;
    await onSetLabel(node.id, label.trim() || undefined);
  }

  function toggleNode(node: PiSessionTreeNode) {
    if (!node.childrenCount) return;
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  async function forkFrom(node: PiSessionTreeNode) {
    const preview = forkMessagesById.get(node.id)?.text ?? node.title;
    const confirmed = window.confirm(`Fork from this message?\n\n${preview}`);
    if (!confirmed) return;
    try {
      setBusyAction(`fork:${node.id}`);
      await onForkSession(node.id);
    } finally {
      setBusyAction(null);
    }
  }

  async function cloneCurrentBranch() {
    const confirmed = window.confirm("Clone current active branch into a new session?");
    if (!confirmed) return;
    try {
      setBusyAction("clone");
      await onCloneSession();
    } finally {
      setBusyAction(null);
    }
  }

  const directLabelWrite = tree?.activeLeafSource === "jsonl-inferred";

  return (
    <section className="rounded-2xl border border-border bg-background/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <GitBranch size={14} /> Session tree
        </div>
        <Button size="sm" variant="ghost" disabled={busyAction === "clone"} onClick={() => void cloneCurrentBranch()}>
          <GitPullRequest size={12} /> {busyAction === "clone" ? "Cloning" : "Clone"}
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface p-2 text-xs text-muted-foreground">
        <Filter size={13} />
        <select
          value={filterMode}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
          onChange={(event) => setFilterMode(event.target.value as TreeFilterMode)}
        >
          {filterModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px]">{visibleNodes.length}/{nodes.length}</span>
      </div>

      {tree?.parentSession ? (
        <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-2 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-[0.14em] text-primary">Fork lineage</div>
          <div className="truncate font-mono text-muted-foreground" title={tree.parentSession}>
            parent: {tree.parentSession}
          </div>
        </div>
      ) : null}

      {directLabelWrite ? (
        <div className="mb-3 rounded-xl border border-warning/20 bg-warning/10 p-2 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em] text-warning">
            <Info size={12} /> Label mode
          </div>
          <div className="leading-5">
            Labels currently append JSONL entries directly. SDK `SessionManager.appendLabelChange()` / extension `pi.setLabel()` should replace this when sidecar lands.
          </div>
        </div>
      ) : null}

      {tree?.activeLeafSource ? (
        <div className="mb-3 rounded-xl border border-border bg-surface p-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold uppercase tracking-[0.14em]">Cursor</span>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-foreground">{tree.activeLeafSource}</span>
          </div>
          {tree.activeLeafNote ? <div className="mt-1 leading-5">{tree.activeLeafNote}</div> : null}
        </div>
      ) : null}

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
        {visibleNodes.length ? (
          visibleNodes.map((node) => {
            const active = node.id === tree?.activeLeafId;
            const inBranch = branchIds.has(node.id);
            const collapsed = collapsedIds.has(node.id);
            const canFork = node.role === "user" || forkableIds.has(node.id);
            const forkBusy = busyAction === `fork:${node.id}`;
            return (
              <div
                key={node.id}
                className={cn(
                  "group rounded-xl border bg-surface/70 px-2 py-1.5 transition",
                  active
                    ? "border-primary/40 shadow-[inset_2px_0_0_var(--primary)]"
                    : inBranch
                      ? "border-primary/20 bg-primary/5"
                      : "border-transparent hover:border-border",
                )}
                style={{ marginLeft: Math.min(node.depth, 6) * 10 }}
              >
                <div className="flex items-start gap-2">
                  <button
                    className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                    disabled={!node.childrenCount}
                    onClick={() => toggleNode(node)}
                  >
                    {node.childrenCount ? collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-muted-foreground/40")} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                        {node.role ?? node.type}
                      </span>
                      {inBranch ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">branch</span> : null}
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
                      <Button size="icon" variant="ghost" aria-label="Fork from entry" disabled={Boolean(busyAction)} onClick={() => void forkFrom(node)}>
                        <GitFork size={11} />
                      </Button>
                    ) : null}
                    <Button size="icon" variant="ghost" aria-label="Set label" disabled={Boolean(busyAction)} onClick={() => void editLabel(node)}>
                      <Tag size={11} />
                    </Button>
                  </div>
                </div>
                {forkBusy ? <div className="mt-2 pl-6 font-mono text-[10px] text-primary">forking...</div> : null}
              </div>
            );
          })
        ) : nodes.length ? (
          <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">No nodes match filter.</div>
        ) : (
          <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">No session tree available.</div>
        )}
      </div>
    </section>
  );
}

function filterVisibleNodes(nodes: PiSessionTreeNode[], filterMode: TreeFilterMode, collapsedIds: Set<string>): PiSessionTreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    if (hasCollapsedAncestor(node, byId, collapsedIds)) return false;
    if (filterMode === "all") return true;
    if (filterMode === "labeled-only") return Boolean(node.label);
    if (filterMode === "user-only") return node.role === "user";
    if (filterMode === "no-tools") return node.role !== "toolResult" && node.type !== "custom";
    return node.type !== "custom";
  });
}

function hasCollapsedAncestor(node: PiSessionTreeNode, byId: Map<string, PiSessionTreeNode>, collapsedIds: Set<string>): boolean {
  let parentId = node.parentId;
  while (parentId) {
    if (collapsedIds.has(parentId)) return true;
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
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
