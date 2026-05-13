import { AlertTriangle, Command, PanelTop, ShieldAlert } from "lucide-react";
import { useI18n } from "@/shared/i18n";
import type { PiCommand, PiExtensionError, PiExtensionPanel } from "@/shared/pi/types";

type ExtensionPanelSection = "commands" | "panels" | "errors";

interface ExtensionsPanelProps {
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionErrors: PiExtensionError[];
  sections?: ExtensionPanelSection[];
}

export function ExtensionsPanel({ commands, extensionPanels, extensionErrors, sections = ["commands", "panels", "errors"] }: ExtensionsPanelProps) {
  const { t } = useI18n();
  const visibleSections = new Set(sections);

  return (
    <div className="space-y-4">
      {visibleSections.has("commands") ? (
        <section className="rounded-none border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Command size={14} /> {t("extension.commands")}
          </div>
          <div className="space-y-2">
            {commands.length ? (
              commands.map((command) => (
                <div key={command.name} className="rounded-none border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">/{command.name}</span>
                    <span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{command.source}</span>
                  </div>
                  {command.description ? <div className="mt-2 text-xs text-muted-foreground">{command.description}</div> : null}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {command.dangerous ? (
                      <span className="inline-flex items-center gap-1 rounded-none bg-danger/10 px-2 py-0.5 text-danger">
                        <ShieldAlert size={11} /> {t("extension.confirm")}
                      </span>
                    ) : null}
                    {command.path ? <span className="truncate font-mono">{command.path}</span> : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noCommands")}</div>
            )}
          </div>
        </section>
      ) : null}

      {visibleSections.has("panels") ? (
        <section className="rounded-none border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <PanelTop size={14} /> {t("extension.ui")}
          </div>
          <div className="space-y-2">
            {extensionPanels.length ? (
              extensionPanels.map((panel) => (
                <div key={panel.key} className="rounded-none border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{panel.title}</span>
                    <span className="rounded-none bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{panel.placement}</span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                    {panel.lines.map((line, index) => (
                      <div key={`${panel.key}-${index}`}>{line}</div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noPanels")}</div>
            )}
          </div>
        </section>
      ) : null}

      {visibleSections.has("errors") ? (
        <section className="rounded-none border border-danger/20 bg-danger/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-danger">
            <AlertTriangle size={14} /> {t("extension.errors")}
          </div>
          <div className="space-y-2">
            {extensionErrors.length ? (
              extensionErrors.slice(0, 4).map((error, index) => (
                <div key={`error-${error.id}-${index}`} className="rounded-none border border-danger/20 bg-surface p-3">
                  <div className="mb-1 text-xs font-semibold text-foreground">{error.event ?? t("extension.errorFallback")}</div>
                  <div className="text-xs leading-5 text-muted-foreground">{error.message}</div>
                  {error.extensionPath ? <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{error.extensionPath}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noErrors")}</div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
