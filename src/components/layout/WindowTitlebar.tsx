import type { ReactNode } from "react";
import { Maximize2, Minus, Power, Square, X } from "lucide-react";
import { PiMark } from "@/components/brand/PiMark";
import { useI18n } from "@/shared/i18n";
import { closeWindow, minimizeWindow, toggleFullscreenWindow, toggleMaximizeWindow } from "@/shared/window-controls";

interface WindowTitlebarProps {
  onRestartApp?: () => Promise<void> | void;
}

export function WindowTitlebar({ onRestartApp }: WindowTitlebarProps) {
  const { t } = useI18n();

  return (
    <div className="window-drag-region flex h-10 shrink-0 select-none items-center justify-between border-b border-border bg-surface/88 px-2 backdrop-blur-[2px]" data-tauri-drag-region onDoubleClick={() => void toggleMaximizeWindow()}>
          <PiMark className="size-6" />
      

      <div
        className="window-no-drag flex shrink-0 items-center gap-0.5  border-border/70 pl-1"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {onRestartApp ? (
          <TitlebarButton label={t("window.restartApp")} onClick={onRestartApp}>
            <Power size={13} />
          </TitlebarButton>
        ) : null}
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
          ? "inline-flex size-7 cursor-pointer items-center justify-center rounded-none text-muted-foreground transition hover:bg-danger/12 hover:text-danger"
          : "inline-flex size-7 cursor-pointer items-center justify-center rounded-none text-muted-foreground transition hover:bg-muted hover:text-foreground"
      }
      onClick={() => void onClick()}
    >
      {children}
    </button>
  );
}
