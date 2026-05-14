import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Children, cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

const buttonVariants = cva(
  "inline-flex cursor-pointer shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none border border-transparent text-[12px] font-semibold uppercase tracking-[0.1em] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-default disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent text-primary hover:bg-primary/10",
        primary: "bg-transparent text-primary hover:bg-primary/10",
        secondary: "bg-surface/70 text-foreground hover:bg-muted",
        outline: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "bg-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        destructive: "bg-transparent text-destructive hover:bg-destructive/10",
        danger: "bg-transparent text-destructive hover:bg-destructive/10",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-2.5 py-1.5",
        sm: "h-6 px-2",
        md: "h-8 px-2.5",
        lg: "h-9 px-4",
        icon: "size-7 p-0 tracking-normal",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props}>{asChild ? children : withDefaultIconSize(children)}</Comp>;
}

export { buttonVariants };

function withDefaultIconSize(children: ReactNode) {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const icon = child as ReactElement<{ size?: number | string; width?: number | string; height?: number | string }>;
    if (icon.props.size != null || icon.props.width != null || icon.props.height != null) return child;
    return cloneElement(icon, { size: 12 });
  });
}
