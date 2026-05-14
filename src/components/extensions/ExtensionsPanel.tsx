import { AlertTriangle, Command, Loader2, PanelTop, Power, ShieldAlert, Trash2 } from "lucide-react";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import type { PiCommand, PiExtensionError, PiExtensionPanel, PiExtensionResource } from "@/shared/pi/types";

type ExtensionPanelSection = "resources" | "commands" | "panels" | "errors";

type ActionStatus = { kind: "idle" | "success" | "error"; text: string };

interface ExtensionsPanelProps {
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionErrors: PiExtensionError[];
  extensionResources?: PiExtensionResource[];
  actionStatus?: ActionStatus;
  busyPath?: string | null;
  sections?: ExtensionPanelSection[];
  onToggleExtension?: (resource: PiExtensionResource) => Promise<void> | void;
  onDeleteExtension?: (resource: PiExtensionResource) => Promise<void> | void;
}

export function ExtensionsPanel({ commands, extensionPanels, extensionErrors, extensionResources = [], actionStatus, busyPath, sections = ["resources", "commands", "panels", "errors"], onToggleExtension, onDeleteExtension }: ExtensionsPanelProps) {
  const { t } = useI18n();
  const visibleSections = new Set(sections);

  return (
    <div className="space-y-4">
      {visibleSections.has("resources") ? (
        <section className="rounded-none border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <PanelTop size={14} /> {t("extension.resources")}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{t("extension.resourcesHelp")}</div>
            </div>
            <span className="rounded-none bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{extensionResources.length}</span>
          </div>
          {actionStatus?.kind && actionStatus.kind !== "idle" ? (
            <div className={cn("mb-3 border px-3 py-2 text-xs", actionStatus.kind === "success" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{actionStatus.text}</div>
          ) : null}
          <div className="space-y-2">
            {extensionResources.length ? (
              extensionResources.map((resource) => {
                const busy = busyPath === resource.path;
                return (
                  <div key={resource.id} className="rounded-none border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">{resource.name}</span>
                          <span className={cn("rounded-none px-2 py-0.5 text-[10px]", resource.enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{resource.enabled ? t("extension.active") : t("extension.stopped")}</span>
                          <span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{resource.scope}</span>
                          <span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{resource.source}</span>
                        </div>
                        <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={resource.path}>{resource.path}</div>
                        {resource.disabledByPattern ? <div className="mt-2 text-[11px] text-muted-foreground">{t("extension.disabledBySettings")}</div> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-7 cursor-pointer items-center gap-1 border border-border px-2 text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 [&_span]:text-[12px] [&_span]:leading-none"
                          disabled={busy || !onToggleExtension}
                          onClick={() => onToggleExtension?.(resource)}
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                          <span>{resource.enabled ? t("extension.stop") : t("extension.enable")}</span>
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 cursor-pointer items-center gap-1 border border-danger/25 px-2 text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-45 [&_span]:text-[12px] [&_span]:leading-none"
                          disabled={busy || !resource.removable || !onDeleteExtension}
                          onClick={() => onDeleteExtension?.(resource)}
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          <span>{t("extension.delete")}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noResources")}</div>
            )}
          </div>
        </section>
      ) : null}

      {visibleSections.has("commands") ? (
        <section className="rounded-none border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Command size={14} /> {t("extension.commands")}
          </div>
          <div className="space-y-2">
            {commands.length ? commands.map((command) => (
              <div key={command.name} className="rounded-none border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">/{command.name}</span>
                  <span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{command.source}</span>
                </div>
                {command.description ? <div className="mt-2 text-xs text-muted-foreground">{command.description}</div> : null}
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {command.dangerous ? <span className="inline-flex items-center gap-1 rounded-none bg-danger/10 px-2 py-0.5 text-danger"><ShieldAlert size={11} /> {t("extension.confirm")}</span> : null}
                  {command.path ? <span className="truncate font-mono">{command.path}</span> : null}
                </div>
              </div>
            )) : <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noCommands")}</div>}
          </div>
        </section>
      ) : null}

      {visibleSections.has("panels") ? (
        <section className="rounded-none border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><PanelTop size={14} /> {t("extension.ui")}</div>
          <div className="space-y-2">
            {extensionPanels.length ? extensionPanels.map((panel) => (
              <div key={panel.key} className="rounded-none border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold">{panel.title}</span><span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{panel.placement}</span></div>
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">{panel.lines.map((line, index) => <div key={`${panel.key}-${index}`}>{line}</div>)}</div>
              </div>
            )) : <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noPanels")}</div>}
          </div>
        </section>
      ) : null}

      {visibleSections.has("errors") ? (
        <section className="rounded-none border border-danger/20 bg-danger/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-danger"><AlertTriangle size={14} /> {t("extension.errors")}</div>
          <div className="space-y-2">
            {extensionErrors.length ? extensionErrors.slice(0, 4).map((error, index) => (
              <div key={`error-${error.id}-${index}`} className="rounded-none border border-danger/20 bg-surface p-3">
                <div className="mb-1 text-xs font-semibold text-foreground">{error.event ?? t("extension.errorFallback")}</div>
                <div className="text-xs leading-5 text-muted-foreground">{error.message}</div>
                {error.extensionPath ? <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{error.extensionPath}</div> : null}
              </div>
            )) : <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noErrors")}</div>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
