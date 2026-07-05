"use client";

import { useState } from "react";
import { DiscountScenarioCalculator } from "./DiscountScenarioCalculator";
import { DeadStockTable } from "./DeadStockTable";
import type { DeadStockProduct } from "@/lib/analytics/dead-stock";

interface Props {
  products: DeadStockProduct[];
}

export function LiquidationWorkspace({ products }: Props) {
  const [discountPct, setDiscountPct] = useState(30);

  return (
    <div className="space-y-6">
      <DiscountScenarioCalculator products={products} discountPct={discountPct} onChangeDiscount={setDiscountPct} />
      <DeadStockTable products={products} discountPct={discountPct} />
    </div>
  );
}
