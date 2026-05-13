import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  onChange: (value: string) => void;
}

export function SearchableSelect({ value, options, placeholder = "Select", searchPlaceholder = "Search", emptyText = "No results", className, onChange }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const groups = useMemo(() => groupOptions(filtered), [filtered]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 border border-border bg-surface px-3 text-left text-sm text-foreground outline-none transition hover:border-primary/35 focus:border-primary/50"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 border border-border bg-popover shadow-lg shadow-black/5">
          <div className="flex h-9 items-center gap-2 border-b border-border bg-surface/85 px-2 text-muted-foreground">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 cursor-text bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {groups.length ? groups.map((group) => (
              <div key={group.name}>
                {group.name ? <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.name}</div> : null}
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/70"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="size-4 shrink-0 text-primary">{option.value === value ? <Check size={14} /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{option.label}</span>
                      {option.description ? <span className="block truncate text-[10px] text-muted-foreground">{option.description}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )) : <div className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyText}</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function filterOptions(options: SearchableSelectOption[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) => [option.label, option.description, option.group, option.value].filter(Boolean).join(" ").toLowerCase().includes(q));
}

function groupOptions(options: SearchableSelectOption[]) {
  const groups = new Map<string, SearchableSelectOption[]>();
  for (const option of options) {
    const group = option.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), option]);
  }
  return Array.from(groups.entries()).map(([name, groupOptions]) => ({ name, options: groupOptions }));
}
