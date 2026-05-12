import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border font-mono text-xs font-semibold uppercase tracking-[0.18em] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary/45 bg-transparent text-primary shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/10",
        primary: "border-primary/45 bg-transparent text-primary shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/10",
        secondary: "border-border bg-surface/70 text-foreground hover:bg-muted",
        outline: "border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground",
        destructive: "border-destructive/45 bg-transparent text-destructive shadow-[inset_2px_0_0_var(--destructive)] hover:bg-destructive/10",
        danger: "border-destructive/45 bg-transparent text-destructive shadow-[inset_2px_0_0_var(--destructive)] hover:bg-destructive/10",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-8",
        icon: "size-9 p-0 tracking-normal",
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

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
