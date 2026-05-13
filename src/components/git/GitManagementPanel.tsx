import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Cloud, GitBranch, GitCommitHorizontal, Loader2, Minus, Plus, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";

interface GitManagementPanelProps {
  cwd: string;
  model?: string;
  thinkingLevel?: string;
  sessionFile?: string;
  isRunning?: boolean;
  onRefresh: () => Promise<void> | void;
}

type GitFile = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
};

type GitStatus = {
  repoRoot: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  files: GitFile[];
};

type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  subject: string;
  refs?: string;
};

export function GitManagementPanel({ cwd, model, thinkingLevel, sessionFile, isRunning = false, onRefresh }: GitManagementPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"refresh" | "commit" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const cwdRef = useRef(cwd);
  const loadingCwd = t("common.loading");

  const stagedFiles = useMemo(() => status?.files.filter(isStaged) ?? [], [status]);
  const changedFiles = useMemo(() => status?.files.filter(isUnstaged) ?? [], [status]);
  const hasFileChanges = Boolean(status && status.files.length > 0);
  const shouldSync = Boolean(status && !hasFileChanges && (status.ahead > 0 || status.behind > 0));

  const refreshGit = useCallback(async (silent = false) => {
    const targetCwd = cwdRef.current;
    if (targetCwd === loadingCwd) return;
    if (!silent) setBusy("refresh");
    try {
      const [next, nextCommits] = await Promise.all([
        invoke<GitStatus>("pi_git_status", { cwd: targetCwd }),
        invoke<GitCommit[]>("pi_git_log", { cwd: targetCwd, limit: 40 }),
      ]);
      if (targetCwd !== cwdRef.current) return;
      setStatus((current) => (current && shallowGitEqual(current, next) ? current : next));
      setCommits((current) => (shallowCommitsEqual(current, nextCommits) ? current : nextCommits));
      setError(null);
    } catch (caught) {
      setStatus(null);
      setCommits([]);
      setError(errorText(caught));
    } finally {
      if (!silent) setBusy(null);
    }
  }, [loadingCwd]);

  useEffect(() => {
    cwdRef.current = cwd;
    void refreshGit();
  }, [cwd, refreshGit]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refreshGit(true);
    };
    const interval = window.setInterval(tick, 2500);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshGit]);

  async function runGitAction(action: "stage" | "unstage" | "discard", path?: string) {
    if (action === "discard" && path && !window.confirm(t("git.discardConfirm", { path }))) return;
    setBusy("refresh");
    try {
      await invoke("pi_git_action", { cwd, action, path: path ?? null });
      await refreshGit(true);
      void onRefresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    if (!status?.upstream) return;
    setBusy("refresh");
    try {
      await invoke("pi_git_sync", { cwd });
      await refreshGit(true);
      void onRefresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function generateCommitMessage() {
    if (isRunning || !status?.staged) return;
    setBusy("generate");
    try {
      const nextMessage = await invoke<string>("pi_git_generate_commit_message", { cwd, model: model ?? null, thinkingLevel: thinkingLevel ?? null, sessionFile: sessionFile ?? null });
      setMessage(nextMessage.trim());
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setBusy("commit");
    try {
      await invoke("pi_git_commit", { cwd, message: trimmed });
      setMessage("");
      await refreshGit();
      void onRefresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar/70 text-xs">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5 font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <ChevronDown size={13} />
          <span>{t("git.changesPanel")}</span>
        </div>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <ToolbarButton
            title={shouldSync ? t("git.sync") : t("git.commit")}
            onClick={() => shouldSync ? void sync() : void commit()}
            disabled={shouldSync ? !status?.upstream || busy === "refresh" : !message.trim() || !status?.staged || busy === "commit" || busy === "generate"}
          >
            {shouldSync ? <Cloud size={13} /> : <Check size={13} />}
          </ToolbarButton>
          <ToolbarButton title={t("git.refresh")} onClick={() => void refreshGit()} disabled={busy === "refresh"}><RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : undefined} /></ToolbarButton>
        </div>
      </header>

      <div className="space-y-2 p-2">
        <div className="truncate font-mono text-[10px] text-muted-foreground" title={status?.repoRoot ?? cwd}>{status?.repoRoot ?? cwd}</div>
        <div className="relative">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void commit();
            }}
            placeholder={t("git.commitPlaceholder", { branch: status?.branch ?? "master" })}
            className="h-7 w-full border border-border bg-surface py-0 pl-2 pr-8 text-xs outline-none transition placeholder:text-muted-foreground focus:border-primary/40"
          />
          <button
            type="button"
            className="absolute right-1 top-1/2 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={isRunning ? t("git.generateCommitBusySession") : t("git.generateCommit")}
            aria-label={t("git.generateCommit")}
            disabled={Boolean(busy) || isRunning || !status?.staged}
            onClick={() => void generateCommitMessage()}
          >
            {busy === "generate" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          </button>
        </div>
        <Button
          className="h-7 w-full cursor-pointer bg-primary/70 text-primary-foreground hover:bg-primary/80 disabled:cursor-default"
          onClick={() => shouldSync ? void sync() : void commit()}
          disabled={shouldSync ? !status?.upstream || busy === "refresh" : !message.trim() || !status?.staged || busy === "commit" || busy === "generate"}
        >
          {shouldSync ? <Cloud size={13} /> : <Check size={13} />}
          {shouldSync ? t("git.syncChanges", { ahead: status?.ahead ?? 0, behind: status?.behind ?? 0 }) : busy === "commit" ? t("git.committing") : t("git.commit")}
        </Button>
        {status ? (
          <div className="flex items-center gap-2 px-0.5 font-mono text-[10px] text-muted-foreground">
            <GitBranch size={11} />
            <span className="truncate">{status.branch}</span>
            {status.upstream ? <span className="truncate">{status.upstream}</span> : null}
            {status.ahead || status.behind ? <span>↑{status.ahead} ↓{status.behind}</span> : null}
            <span className="ml-auto">{t("git.autoRefresh")}</span>
          </div>
        ) : null}
        {error ? <div className="border border-danger/20 bg-danger/5 p-2 text-xs leading-5 text-danger">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-3">
        <ChangeGroup
          title={t("git.stagedChanges")}
          count={stagedFiles.length}
          empty={t("git.noStagedChanges")}
          open={stagedOpen}
          onToggle={() => setStagedOpen((value) => !value)}
          actionIcon={<Minus size={13} />}
          actionTitle={t("git.unstageAll")}
          onAction={() => void runGitAction("unstage")}
        >
          {stagedFiles.map((file) => <GitFileRow key={`staged:${file.path}`} file={file} />)}
        </ChangeGroup>
        <ChangeGroup
          title={t("git.changesPanel")}
          count={changedFiles.length}
          empty={t("git.noChangesLoaded")}
          open={changesOpen}
          onToggle={() => setChangesOpen((value) => !value)}
          actionIcon={<Plus size={13} />}
          actionTitle={t("git.stageAll")}
          onAction={() => void runGitAction("stage")}
        >
          {changedFiles.map((file) => <GitFileRow key={`changed:${file.path}`} file={file} onStage={() => void runGitAction("stage", file.path)} onDiscard={() => void runGitAction("discard", file.path)} />)}
        </ChangeGroup>

        <CommitGraph commits={commits} currentBranch={status?.branch} open={graphOpen} onToggle={() => setGraphOpen((value) => !value)} />
      </div>
    </section>
  );
}

function ChangeGroup({ title, count, empty, open, onToggle, actionIcon, actionTitle, onAction, children }: { title: string; count: number; empty: string; open: boolean; onToggle: () => void; actionIcon?: ReactNode; actionTitle?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <div className="mt-1">
      <div className="group flex h-6 items-center justify-between px-2 text-[11px] font-medium text-muted-foreground">
        <button type="button" onClick={onToggle} className="flex min-w-0 cursor-pointer items-center gap-1 hover:text-foreground">
          <ChevronDown size={13} className={cn("transition-transform", !open && "-rotate-90")} />
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          {count && onAction ? <button type="button" title={actionTitle} onClick={onAction} className="inline-flex size-5 cursor-pointer items-center justify-center opacity-0 hover:text-primary group-hover:opacity-100">{actionIcon}</button> : null}
          {count ? <span className="rounded-full bg-primary/20 px-1.5 font-mono text-[10px] text-primary">{count}</span> : null}
        </div>
      </div>
      {open ? (count ? <div>{children}</div> : <div className="px-6 py-1 text-[11px] text-muted-foreground">{empty}</div>) : null}
    </div>
  );
}

function GitFileRow({ file, onStage, onDiscard }: { file: GitFile; onStage?: () => void; onDiscard?: () => void }) {
  const name = basename(file.path);
  const dir = dirname(file.path);
  return (
    <div className="group flex h-6 items-center gap-2 px-3 text-xs hover:bg-muted/60">
      <FileGlyph path={file.path} status={statusLabel(file)} />
      <span className="min-w-0 truncate text-foreground" title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}>{name}</span>
      {dir ? <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{dir}</span> : <span className="flex-1" />}
      <div className="hidden items-center gap-0.5 group-hover:flex">
        {onStage ? <IconButton title="Stage" onClick={onStage}><Plus size={12} /></IconButton> : null}
        {onDiscard ? <IconButton title="Discard" onClick={onDiscard}><RotateCcw size={12} /></IconButton> : null}
      </div>
      <span className={cn("font-mono text-[10px]", statusLabel(file) === "D" ? "text-danger" : "text-primary")}>{statusLabel(file)}</span>
    </div>
  );
}

function CommitGraph({ commits, currentBranch, open, onToggle }: { commits: GitCommit[]; currentBranch?: string; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 border-t border-border pt-1">
      <div className="flex h-6 items-center justify-between px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <button type="button" onClick={onToggle} className="flex min-w-0 cursor-pointer items-center gap-1 hover:text-foreground">
          <ChevronDown size={13} className={cn("transition-transform", !open && "-rotate-90")} />
          <span>{t("git.graph")}</span>
        </button>
        {commits.length ? <span className="font-mono text-[10px]">{commits.length}</span> : null}
      </div>
      {open ? (commits.length ? (
        <div className="px-2 pb-2">
          {commits.map((commit, index) => (
            <CommitRow key={commit.hash} commit={commit} index={index} currentBranch={currentBranch} isLast={index === commits.length - 1} />
          ))}
        </div>
      ) : (
        <div className="px-6 py-1 text-[11px] text-muted-foreground">{t("git.noCommitsLoaded")}</div>
      )) : null}
    </div>
  );
}

function CommitRow({ commit, index, currentBranch, isLast }: { commit: GitCommit; index: number; currentBranch?: string; isLast: boolean }) {
  const color = graphColors[index % graphColors.length];
  const refs = parseRefs(commit.refs);
  const isHead = refs.some((ref) => ref === "HEAD" || ref === currentBranch || ref.endsWith(`/${currentBranch}`));
  return (
    <div className="group grid min-h-7 grid-cols-[22px_1fr] gap-1 text-xs hover:bg-muted/50">
      <div className="relative flex justify-center">
        {!isLast ? <span className={cn("absolute left-1/2 top-3 h-full w-px -translate-x-1/2", color.line)} /> : null}
        <span className={cn("relative mt-2 size-2.5 rounded-full border", color.dot, isHead && "ring-2 ring-primary/25")} />
      </div>
      <div className="min-w-0 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitCommitHorizontal size={12} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-foreground" title={commit.subject}>{commit.subject}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{commit.shortHash}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{commit.author}</span>
          {refs.map((ref) => <span key={ref} className={cn("rounded-full px-1.5 py-px font-mono", ref === currentBranch || ref.endsWith(`/${currentBranch}`) ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{ref}</span>)}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return <button type="button" title={title} disabled={disabled} onClick={onClick} className="inline-flex size-6 cursor-pointer items-center justify-center hover:text-primary disabled:cursor-default disabled:opacity-40">{children}</button>;
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-primary">{children}</button>;
}

function FileGlyph({ path, status }: { path: string; status: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const text = ext === path ? "•" : ext.slice(0, 2).toUpperCase();
  return <span className={cn("w-5 shrink-0 font-mono text-[10px]", status === "D" ? "text-danger" : "text-primary")}>{text}</span>;
}

function isStaged(file: GitFile) {
  return file.indexStatus !== " " && file.indexStatus !== "?";
}

function isUnstaged(file: GitFile) {
  return file.worktreeStatus !== " " || file.indexStatus === "?";
}

function statusLabel(file: GitFile) {
  if (file.indexStatus === "?" || file.worktreeStatus === "?") return "U";
  if (file.indexStatus !== " ") return file.indexStatus;
  return file.worktreeStatus.trim() || "M";
}

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

const graphColors = [
  { dot: "border-sky-400 bg-sky-400", line: "bg-sky-400/60" },
  { dot: "border-violet-400 bg-violet-400", line: "bg-violet-400/60" },
  { dot: "border-emerald-400 bg-emerald-400", line: "bg-emerald-400/60" },
  { dot: "border-rose-400 bg-rose-400", line: "bg-rose-400/60" },
  { dot: "border-amber-400 bg-amber-400", line: "bg-amber-400/60" },
];

function parseRefs(refs?: string) {
  return (refs ?? "")
    .split(",")
    .map((ref) => ref.trim().replace(/^HEAD -> /, ""))
    .filter(Boolean)
    .slice(0, 3);
}

function shallowGitEqual(left: GitStatus, right: GitStatus) {
  if (
    left.repoRoot !== right.repoRoot ||
    left.branch !== right.branch ||
    left.upstream !== right.upstream ||
    left.ahead !== right.ahead ||
    left.behind !== right.behind ||
    left.staged !== right.staged ||
    left.unstaged !== right.unstaged ||
    left.untracked !== right.untracked ||
    left.files.length !== right.files.length
  ) return false;
  return left.files.every((file, index) => {
    const other = right.files[index];
    return other && file.path === other.path && file.originalPath === other.originalPath && file.indexStatus === other.indexStatus && file.worktreeStatus === other.worktreeStatus;
  });
}

function shallowCommitsEqual(left: GitCommit[], right: GitCommit[]) {
  if (left.length !== right.length) return false;
  return left.every((commit, index) => {
    const other = right[index];
    return other && commit.hash === other.hash && commit.refs === other.refs && commit.subject === other.subject;
  });
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
