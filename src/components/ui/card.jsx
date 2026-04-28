import React from "react";
import { cn } from "@/lib/utils";

export function Card({ className = "", ...props }) {
  return <div className={cn("rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-professional", className)} {...props} />;
}

export function CardContent({ className = "", ...props }) {
  return <div className={cn("p-6", className)} {...props} />;
}
