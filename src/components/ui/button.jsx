import React from "react";
import { cn } from "@/lib/utils";

export function Button({ className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
