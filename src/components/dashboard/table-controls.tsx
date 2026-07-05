"use client";

import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export function FilterChip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "critical" | "warning" | "ok";
}) {
  const activeClass =
    tone === "critical"
      ? "bg-destructive/10 text-destructive border-destructive/40"
      : tone === "warning"
        ? "bg-warning/10 text-warning border-warning/40"
        : tone === "ok"
          ? "bg-primary/10 text-primary border-primary/40"
          : "bg-secondary text-foreground border-border";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
        active ? activeClass : "border-border text-muted-foreground hover:bg-secondary"
      )}
    >
      {label}
    </button>
  );
}

export function SortableHeader({
  label,
  active,
  dir,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("py-2 px-3 font-medium select-none", align === "left" ? "text-left" : "text-right")}>
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          align === "right" && "flex-row-reverse",
          active && "text-foreground"
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}
