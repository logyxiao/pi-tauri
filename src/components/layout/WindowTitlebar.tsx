import { useI18n } from "@/shared/i18n";

export function WindowTitlebar() {
  const { t } = useI18n();

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span className="size-2 rounded-full bg-primary/70" />
        Pi Desktop
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{t("app.titlebar.subtitle")}</div>
    </div>
  );
}
