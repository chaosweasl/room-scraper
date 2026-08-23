import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "outline" | "high" | "new";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-gray-800 text-gray-300",
  outline: "border border-gray-700 text-gray-400",
  high: "bg-red-950/60 text-red-400 border border-red-900/50",
  new: "bg-blue-950/60 text-blue-400 border border-blue-900/50",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
