import { File, FileCode2, FileImage, Folder, Globe2, SearchX, Text } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiFileEntry, PiFilePreview } from "@/shared/pi/types";

interface FilesPreviewPanelProps {
  cwd: string;
  files: PiFileEntry[];
  preview: PiFilePreview | null;
  selectedPath?: string | null;
  onSelectFile: (path: string) => Promise<void> | void;
}

export function FilesPreviewPanel({ cwd, files, preview, selectedPath, onSelectFile }: FilesPreviewPanelProps) {
  const { t } = useI18n();

  return (
    <section className="rounded-2xl border border-border bg-background/60 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Folder size={14} /> {t("files.title")}
      </div>

      <div className="mb-3 rounded-xl bg-surface p-3 font-mono text-[11px] text-muted-foreground" title={cwd}>
        cwd: <span className="text-foreground">{cwd}</span>
      </div>

      <div className="max-h-56 space-y-1 overflow-auto rounded-xl border border-border bg-surface p-1.5">
        {files.length ? (
          files.map((entry) => (
            <button
              key={entry.path}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
                entry.kind === "directory" ? "text-muted-foreground" : "text-foreground hover:bg-muted",
                selectedPath === entry.path && "bg-primary/10 text-primary",
              )}
              style={{ paddingLeft: `${8 + entry.depth * 12}px` }}
              disabled={entry.kind === "directory"}
              onClick={() => void onSelectFile(entry.path)}
              title={entry.path}
            >
              {entry.kind === "directory" ? <Folder size={13} /> : <File size={13} />}
              <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
              {entry.size != null && entry.kind === "file" ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(entry.size)}</span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <SearchX size={14} /> {t("files.noFiles")}
          </div>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
        {preview ? <PreviewBody preview={preview} /> : <div className="p-3 text-xs text-muted-foreground">{t("files.selectPreview")}</div>}
      </div>
    </section>
  );
}

function PreviewBody({ preview }: { preview: PiFilePreview }) {
  const { t } = useI18n();
  const Icon = preview.kind === "markdown" ? Text : preview.kind === "html" ? Globe2 : preview.kind === "image" ? FileImage : FileCode2;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Icon size={14} className="text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono font-semibold" title={preview.path}>
          {preview.path}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{preview.kind}</span>
      </div>
      {preview.kind === "image" ? (
        <div className="p-3 text-xs leading-5 text-muted-foreground">
          {t("files.imagePlaceholder")} {preview.mime ? `(${preview.mime})` : null}
        </div>
      ) : preview.kind === "binary" || preview.kind === "missing" ? (
        <div className="p-3 text-xs leading-5 text-muted-foreground">{preview.content ?? t("files.binaryUnavailable")}</div>
      ) : (
        <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 text-foreground">
          {preview.content}
          {preview.truncated ? `\n\n${t("files.truncated")}` : ""}
        </pre>
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}
