import type { ReactNode } from "react";
import { GitBranch, GitCommitHorizontal, GitCompare, GitPullRequest, RefreshCw, SquareActivity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n";

interface GitManagementPanelProps {
  cwd: string;
  onRefresh: () => Promise<void> | void;
}

export function GitManagementPanel({ cwd, onRefresh }: GitManagementPanelProps) {
  const { t } = useI18n();

  return (
    <section className="border border-border bg-background/55">
      <div className="border-b border-border bg-surface/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch size={14} className="text-primary" /> {t("git.title")}
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={cwd}>{cwd}</div>
          </div>
          <Button className="h-7 px-2 text-[10px]" size="sm" variant="ghost" onClick={() => void onRefresh()}>
            <RefreshCw size={10} /> {t("git.refresh")}
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t("git.branch")} value={t("git.unknown")} />
          <StatCard label={t("git.changes")} value="—" />
          <StatCard label={t("git.sync")} value="—" />
        </div>

        <div className="border border-border bg-surface/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <SquareActivity size={12} /> {t("git.status")}
          </div>
          <div className="text-xs leading-5 text-muted-foreground">{t("git.statusPlaceholder")}</div>
        </div>

        <div className="border border-border bg-surface/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <GitCompare size={12} /> {t("git.changesPanel")}
          </div>
          <div className="space-y-1.5 text-[11px] text-muted-foreground">
            <EmptyLine text={t("git.noChangesLoaded")} />
            <EmptyLine text={t("git.gitIntegrationNote")} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <ActionCard icon={<GitCommitHorizontal size={12} />} title={t("git.commitDraft")} text={t("git.commitDraftDesc")} />
          <ActionCard icon={<GitPullRequest size={12} />} title={t("git.branchOps")} text={t("git.branchOpsDesc")} />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background/70 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-foreground">{value}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="border border-dashed border-border bg-background/55 px-2 py-1.5">{text}</div>;
}

function ActionCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="border border-border bg-background/60 p-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
        <span className="text-primary">{icon}</span> {title}
      </div>
      <div className="text-[11px] leading-4 text-muted-foreground">{text}</div>
    </div>
  );
}
