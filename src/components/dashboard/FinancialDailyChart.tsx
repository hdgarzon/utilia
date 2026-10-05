"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

export interface DailyPoint {
  day: number;
  revenue: number;
  grossProfit: number;
}

interface Props {
  data: DailyPoint[];
  fixedDaily: number;
  title: string;
}

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`;

/**
 * Ventas (barras) y utilidad bruta (línea) de cada día, contra el gasto fijo
 * diario (línea punteada). El día cuya utilidad bruta pasa la línea punteada
 * pagó su parte de arriendo, nómina y servicios. Los días sin venta aparecen
 * en cero: también cargan gasto fijo.
 */
export function FinancialDailyChart({ data, fixedDaily, title }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {fixedDaily > 0
            ? `Los días en que la utilidad bruta supera la línea punteada (${formatCurrency(fixedDaily)} de gasto fijo diario) cubrieron sus gastos fijos.`
            : "Sin presupuesto de gastos fijos: no hay línea de gasto diario."}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatCurrency(value), name]}
            labelFormatter={(day) => `Día ${day}`}
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              fontSize: "12px",
              color: "var(--color-foreground)",
            }}
          />
          <Bar dataKey="revenue" name="Ventas" fill="var(--color-chart-2)" fillOpacity={0.25} radius={[3, 3, 0, 0]} />
          <Line
            type="monotone"
            dataKey="grossProfit"
            name="Utilidad bruta"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {fixedDaily > 0 && (
            <ReferenceLine y={fixedDaily} stroke="var(--color-destructive)" strokeDasharray="4 4" strokeOpacity={0.7} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
