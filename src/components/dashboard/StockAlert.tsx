import { AlertTriangle, XCircle, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "./SectionCard";

interface StockItem {
  id: string;
  name: string;
  qty: number;
  daysOfStock: number;
  minStock: number;
}

interface StockAlertProps {
  items: StockItem[];
}

export function StockAlert({ items }: StockAlertProps) {
  if (items.length === 0) {
    return (
      <SectionCard title="Alertas de Stock" icon={<Package />}>
        <p className="text-xs text-muted-foreground">Sin alertas críticas</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Alertas de Stock"
      icon={<AlertTriangle className="text-warning" />}
      action={
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          {items.length}
        </span>
      }
      bodyClassName="space-y-3"
    >
      <div className="space-y-2">
        {items.slice(0, 5).map((item) => {
          const isCritical = item.qty === 0 || item.qty <= item.minStock;
          return (
            <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                {isCritical ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className="text-xs font-medium truncate">{item.name}</span>
              </div>
              <div className="text-right shrink-0 ml-2">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    item.qty === 0 ? "text-destructive" : item.qty <= item.minStock ? "text-warning" : "text-foreground"
                  )}
                >
                  {item.qty} uds
                </span>
                <p className="text-xs text-muted-foreground">{item.daysOfStock.toFixed(0)}d stock</p>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 5 && (
        <p className="text-xs text-muted-foreground">+{items.length - 5} productos más con alerta</p>
      )}
    </SectionCard>
  );
}
