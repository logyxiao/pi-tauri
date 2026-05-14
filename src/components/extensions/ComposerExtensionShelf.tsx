import type { PiExtensionPanel } from "@/shared/pi/types";

interface ComposerExtensionShelfProps {
  extensionPanels: PiExtensionPanel[];
  placement: PiExtensionPanel["placement"];
}

export function ComposerExtensionShelf({ extensionPanels, placement }: ComposerExtensionShelfProps) {
  const visiblePanels = extensionPanels.filter((panel) => panel.placement === placement && panel.lines.length);
  if (!visiblePanels.length) return null;

  return (
    <div className={placement === "aboveEditor" ? "mb-2 space-y-1.5" : "mt-2 space-y-1.5"}>
      {visiblePanels.map((panel) => (
        <div key={panel.key} className="border border-border/70 bg-background/70 px-2.5 py-2 shadow-[0_6px_24px_rgb(44_54_70/0.06)] backdrop-blur-[2px]">
          <div className="space-y-0.5 font-mono text-[11px] leading-5 text-muted-foreground">
            {panel.lines.map((line, index) => (
              <div key={`${panel.key}-${index}`} className="whitespace-pre-wrap break-words">{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
