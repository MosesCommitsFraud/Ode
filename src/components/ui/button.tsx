import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm font-semibold outline-none transition-all active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_rgb(255_255_255/25%)] hover:brightness-110",
        outline: "border border-input bg-panel-raised hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        secondary: "bg-secondary text-foreground hover:bg-accent",
        destructive: "bg-error text-white hover:bg-error/90",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-7 px-3 text-xs",
        icon: "size-9",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
