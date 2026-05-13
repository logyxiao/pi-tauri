import { AlertTriangle, Blocks, Command, Info, PanelTop, ShieldAlert } from "lucide-react";
import { useI18n } from "@/shared/i18n";
import type { PiCommand, PiExtensionError, PiExtensionMessage, PiExtensionPanel } from "@/shared/pi/types";

interface ExtensionsPanelProps {
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionMessages: PiExtensionMessage[];
  pendingExtensionUi: PiExtensionMessage[];
  extensionErrors: PiExtensionError[];
}

export function ExtensionsPanel({ commands, extensionPanels, extensionMessages, pendingExtensionUi, extensionErrors }: ExtensionsPanelProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
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

      <section className="rounded-none border border-border bg-background/60 p-3">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-2"><Blocks size={14} /> {t("extension.uiMessages")}</span>
          {pendingExtensionUi.length ? (
            <span className="rounded-none border border-primary/30 px-2 py-0.5 text-[10px] text-primary">{pendingExtensionUi.length} {t("extension.pending")}</span>
          ) : null}
        </div>
        {pendingExtensionUi.length ? (
          <div className="mb-3 space-y-2">
            {pendingExtensionUi.map((message) => (
              <div key={message.id} className="rounded-none border border-primary/25 bg-primary/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-primary">{message.title ?? message.method}</span>
                  <span className="rounded-none bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">{t("extension.waiting")}</span>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">{message.message ?? t("extension.waitsFor", { method: message.method })}</div>
                {message.source ? <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{message.source}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          {extensionMessages.length ? (
            extensionMessages.slice(0, 6).map((message) => (
              <div key={message.id} className="rounded-none border border-border bg-surface p-3">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <Info size={12} className={message.level === "error" ? "text-danger" : message.level === "warning" ? "text-warning" : "text-primary"} />
                  <span className="font-semibold">{message.title ?? message.method}</span>
                  {message.expectsResponse ? (
                    <span className="rounded-none bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{t("extension.dialog")}</span>
                  ) : null}
                  <span className="text-muted-foreground">{message.createdAt}</span>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">{message.message ?? t("extension.noBody")}</div>
              </div>
            ))
          ) : (
            <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("extension.noMessages")}</div>
          )}
        </div>
      </section>

      <section className="rounded-none border border-danger/20 bg-danger/5 p-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-danger">
          <AlertTriangle size={14} /> {t("extension.errors")}
        </div>
        <div className="space-y-2">
          {extensionErrors.length ? (
            extensionErrors.slice(0, 4).map((error) => (
              <div key={error.id} className="rounded-none border border-danger/20 bg-surface p-3">
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
    </div>
  );
}
