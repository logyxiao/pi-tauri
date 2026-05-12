import { Brain, Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { demoModels, demoPiState } from "@/shared/pi/mock-data";
import type { PiModel, PiState } from "@/shared/pi/types";

interface ModelSelectorProps {
  state: PiState | null;
  models: PiModel[];
  onModelChange: (model: PiModel) => Promise<void> | void;
}

export function ModelSelector({ state, models, onModelChange }: ModelSelectorProps) {
  const current = state ?? demoPiState;
  const availableModels = models.length ? models : demoModels;
  const currentKey = modelKeyFromState(current.model);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex max-w-64 items-center gap-2 rounded-md border border-border bg-surface/70 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition hover:bg-muted">
          <Brain size={15} className="shrink-0 text-primary" />
          <span className="truncate">{current.model}</span>
          <span className="border border-border bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground">{current.thinkingLevel}</span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="end">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Pi models
        </div>
        {availableModels.map((model) => {
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
                <span className="border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">thinking</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
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
