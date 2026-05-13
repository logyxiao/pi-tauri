import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

interface DropdownMenuContentProps {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}

export function DropdownMenuContent({ children, className, align = "end" }: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={8}
        className={cn(
          "z-50 min-w-44 rounded-none border border-border bg-popover/95 p-1.5 text-sm text-popover-foreground shadow-xl backdrop-blur-[1px]",
          className,
        )}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

interface DropdownMenuItemProps {
  children: ReactNode;
  className?: string;
  onSelect?: () => void;
}

export function DropdownMenuItem({ children, className, onSelect }: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-none px-3 py-2 font-mono text-xs outline-none transition hover:bg-muted focus:bg-muted",
        className,
      )}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}
