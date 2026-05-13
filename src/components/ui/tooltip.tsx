import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

interface TooltipContentProps {
  children: ReactNode;
  className?: string;
}

export function TooltipContent({ children, className }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={8}
        className={cn(
          "z-50 rounded-none border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-lg",
          className,
        )}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-surface" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
