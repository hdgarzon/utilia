"use client";

import { useMemo, useState } from "react";
import { Search, Flame, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface PickerProduct {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  rotationDays: number;
}

interface ProductPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
  excludeIds: number[];
  onPick: (odooProductId: number) => void;
  pending: boolean;
}

function ProductList({
  products,
  query,
  excludeIds,
  showRotation,
  onPick,
  pending,
}: {
  products: PickerProduct[];
  query: string;
  excludeIds: number[];
  showRotation: boolean;
  onPick: (odooProductId: number) => void;
  pending: boolean;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => !excludeIds.includes(p.odooProductId))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [products, query, excludeIds]);

  if (filtered.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Sin productos disponibles</p>;
  }

  return (
    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
      {filtered.map((p) => (
        <button
          key={p.odooProductId}
          disabled={pending}
          onClick={() => onPick(p.odooProductId)}
          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{p.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {p.category ?? "Sin categoría"} · Stock {Math.round(p.stockQty)}
              {showRotation ? ` · ${p.rotationDays}d sin rotar` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ProductPickerDialog({
  open,
  onOpenChange,
  liquidacionPool,
  regularPool,
  excludeIds,
  onPick,
  pending,
}: ProductPickerDialogProps) {
  const [query, setQuery] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Elegir producto</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <Tabs defaultValue="liquidacion">
          <TabsList className="w-full">
            <TabsTrigger value="liquidacion" className="flex-1 gap-1.5">
              <Flame className="h-3.5 w-3.5" /> Liquidación
            </TabsTrigger>
            <TabsTrigger value="regular" className="flex-1 gap-1.5">
              <Package className="h-3.5 w-3.5" /> Regulares
            </TabsTrigger>
          </TabsList>
          <TabsContent value="liquidacion">
            <ProductList
              products={liquidacionPool}
              query={query}
              excludeIds={excludeIds}
              showRotation
              onPick={onPick}
              pending={pending}
            />
          </TabsContent>
          <TabsContent value="regular">
            <ProductList
              products={regularPool}
              query={query}
              excludeIds={excludeIds}
              showRotation={false}
              onPick={onPick}
              pending={pending}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
