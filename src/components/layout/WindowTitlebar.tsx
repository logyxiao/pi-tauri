import type { ReactNode } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { useI18n } from "@/shared/i18n";
import { closeWindow, minimizeWindow, startWindowDrag, toggleFullscreenWindow, toggleMaximizeWindow } from "@/shared/window-controls";

export function WindowTitlebar() {
  const { t } = useI18n();

  return (
    <div
      className="flex h-10 shrink-0 select-none items-center justify-between border-b border-border bg-surface/85 px-2 backdrop-blur-[1px]"
      onDoubleClick={() => void toggleMaximizeWindow()}
      onMouseDown={(event) => {
        if (event.button === 0 && event.detail === 1) void startWindowDrag();
      }}
    >
      <div className="flex min-w-0 items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span className="size-2 rounded-full bg-primary/70" />
        <span className="truncate">Pi Desktop</span>
        <span className="hidden font-mono text-[10px] font-normal lowercase tracking-[0.12em] sm:inline">
          / {t("app.titlebar.subtitle")}
        </span>
      </div>

      <div
        className="flex items-center gap-1"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <TitlebarButton label={t("window.minimize")} onClick={minimizeWindow}>
          <Minus size={13} />
        </TitlebarButton>
        <TitlebarButton label={t("window.maximize")} onClick={toggleMaximizeWindow}>
          <Square size={11} />
        </TitlebarButton>
        <TitlebarButton label={t("window.fullscreen")} onClick={toggleFullscreenWindow}>
          <Maximize2 size={13} />
        </TitlebarButton>
        <TitlebarButton label={t("window.close")} danger onClick={closeWindow}>
          <X size={14} />
        </TitlebarButton>
      </div>
    </div>
  );
}

function TitlebarButton({
  label,
  danger,
  children,
  onClick,
}: {
  label: string;
  danger?: boolean;
  children: ReactNode;
  onClick: () => Promise<void> | void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={
        danger
          ? "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-danger/12 hover:text-danger"
          : "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
      }
      onClick={() => void onClick()}
    >
      {children}
    </button>
  );
}
