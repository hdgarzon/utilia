"use client";

import { useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";

const PRESETS = [20, 30, 50];

interface Props {
  products: DeadStockProduct[];
  discountPct: number;
  onChangeDiscount: (pct: number) => void;
}

export function DiscountScenarioCalculator({ products, discountPct, onChangeDiscount }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState(String(discountPct));

  const totalInvested = products.reduce((s, p) => s + p.investedCapital, 0);
  const recovered = products.reduce((s, p) => s + p.retailValue * (1 - discountPct / 100), 0);
  const net = recovered - totalInvested;
  const isPresetActive = PRESETS.includes(discountPct) && !customOpen;

  function applyCustom() {
    const n = Math.max(0, Math.min(90, Number(customValue) || 0));
    onChangeDiscount(n);
    setCustomOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Simulador de liquidación</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { onChangeDiscount(p); setCustomOpen(false); setCustomValue(String(p)); }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                discountPct === p && !customOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              {p}% off
            </button>
          ))}
          {customOpen ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
                min="0"
                max="90"
                className="w-16 rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button onClick={applyCustom} className="rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground">
                Aplicar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomOpen(true)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                !isPresetActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-secondary"
              )}
            >
              Otro %
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Capital invertido</p>
          <p className="text-xl font-bold">{formatCurrency(totalInvested)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Recuperas con {discountPct}% off</p>
          <p className="text-xl font-bold text-primary">{formatCurrency(recovered)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{net >= 0 ? "Ganancia neta" : "Pérdida neta"}</p>
          <p className={cn("text-xl font-bold", net >= 0 ? "text-primary" : "text-destructive")}>
            {formatCurrency(Math.abs(net))}
          </p>
        </div>
      </div>
    </div>
  );
}
