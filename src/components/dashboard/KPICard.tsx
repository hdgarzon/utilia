import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { SectionCard } from "./SectionCard";

interface KPICardProps {
  title: string;
  value: string;
  subvalue?: string;
  change?: number;
  icon: LucideIcon;
  variant?: "default" | "success" | "warning" | "danger";
  action?: React.ReactNode;
}

export function KPICard({ title, value, subvalue, change, icon: Icon, variant = "default", action }: KPICardProps) {
  const variantClass = {
    default: "text-foreground",
    success: "text-primary",
    warning: "text-warning",
    danger: "text-destructive",
  }[variant];

  const isPositive = change !== undefined && change > 0;
  const isNeutral = change === undefined || change === 0;
  const TrendIcon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;
  const trendColor = isNeutral
    ? "text-muted-foreground"
    : isPositive
    ? "text-primary"
    : "text-destructive";

  return (
    <SectionCard bodyClassName="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">{title}</p>
        <Icon className={cn("h-4 w-4 shrink-0", variantClass)} />
      </div>

      <div className="space-y-1">
        <p className={cn("text-xl md:text-2xl font-bold tracking-tight tabular-nums truncate", variantClass)}>{value}</p>
        {subvalue && <p className="text-xs text-muted-foreground">{subvalue}</p>}
      </div>

      <div className="flex items-center justify-between">
        {change !== undefined && (
          <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            <span>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}% vs ayer
            </span>
          </div>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
    </SectionCard>
  );
}
