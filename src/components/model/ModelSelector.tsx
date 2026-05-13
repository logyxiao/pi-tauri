import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n";
import { demoModels, demoPiState } from "@/shared/pi/mock-data";
import type { PiModel, PiState } from "@/shared/pi/types";

interface ModelSelectorProps {
  state: PiState | null;
  models: PiModel[];
  onModelChange: (model: PiModel) => Promise<void> | void;
  compact?: boolean;
}

export function ModelSelector({ state, models, onModelChange, compact = false }: ModelSelectorProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const current = state ?? demoPiState;
  const availableModels = models.length ? models : demoModels;
  const currentKey = modelKeyFromState(current.model);
  const groupedModels = useMemo(() => groupModels(filterModels(availableModels, query)), [availableModels, query]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={compact
            ? "flex max-w-44 items-center gap-1 px-1 py-1 font-mono text-[9px] leading-none text-muted-foreground transition hover:text-primary"
            : "flex max-w-64 items-center gap-2 rounded-none border border-border bg-surface/70 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition hover:bg-muted"}
          aria-label={t("model.title")}
        >
          <span className="min-w-0 max-w-28 truncate  text-[10px]" >{current.model}</span>
          <ChevronDown size={compact ? 12 : 14} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[32rem] w-80 overflow-auto" align="end">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("model.title")}
        </div>
        <div className="px-2 pb-2" onKeyDown={(event) => event.stopPropagation()}>
          <label className="flex h-9 items-center gap-2 rounded-none border border-border bg-surface/80 px-2 text-muted-foreground">
            <Search size={13} />
            <input
              value={query}
              placeholder={t("model.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {groupedModels.length ? (
          groupedModels.map((group) => (
            <div key={group.provider} className="pb-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.provider} · {group.models.length}
              </div>
              {group.models.map((model) => {
                const selected = modelKey(model) === currentKey || current.model === model.id;
                return (
                  <DropdownMenuItem key={modelKey(model)} onSelect={() => void onModelChange(model)}>
                    <Check size={14} className={selected ? "text-primary" : "text-transparent"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{model.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {model.provider}/{model.id}
                      </div>
                    </div>
                    {model.reasoning ? (
                      <span className="border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{t("model.thinking")}</span>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))
        ) : (
          <div className="rounded-none bg-surface p-3 text-xs text-muted-foreground">{t("model.noMatch")}</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function modelKey(model: PiModel): string {
  return `${model.provider}/${model.id}`;
}

function modelKeyFromState(value: string): string {
  return value.includes("/") ? value : `unknown/${value}`;
}

function filterModels(models: PiModel[], query: string): PiModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((model) => [model.provider, model.id, model.name, model.api].filter(Boolean).join(" ").toLowerCase().includes(q));
}

function groupModels(models: PiModel[]): Array<{ provider: string; models: PiModel[] }> {
  const groups = new Map<string, PiModel[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return Array.from(groups.entries())
    .map(([provider, providerModels]) => ({
      provider,
      models: [...providerModels].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider));
}
