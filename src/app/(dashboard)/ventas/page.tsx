export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { KPICard } from "@/components/dashboard/KPICard";
import { WeeklyPattern } from "@/components/dashboard/WeeklyPattern";
import { getWeeklyPattern } from "@/lib/analytics/weekly-pattern";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, ShoppingCart, TrendingUp, Users } from "lucide-react";
import { colombiaStartOfMonth } from "@/lib/timezone";

async function getSalesData() {
  const snapshots = await prisma.financialSnapshot.findMany({
    where: { date: { gte: colombiaStartOfMonth() } },
    orderBy: { date: "asc" },
  });

  const rawTopProducts = await prisma.productInsight.findMany({
    where: { avgDailySales7d: { gt: 0 } },
    select: {
      id: true,
      odooProductId: true,
      odooTemplateId: true,
      templateName: true,
      name: true,
      category: true,
      avgDailySales7d: true,
      salePrice: true,
    },
  });
  // Consolidar variantes del mismo template antes de ordenar
  const templateMap = new Map<string, typeof rawTopProducts[0] & { avgDailySales7d: number }>();
  for (const p of rawTopProducts) {
    const key = p.odooTemplateId !== null ? `t_${p.odooTemplateId}` : `p_${p.odooProductId}`;
    const existing = templateMap.get(key);
    if (!existing) {
      templateMap.set(key, { ...p, name: p.templateName ?? p.name, avgDailySales7d: p.avgDailySales7d });
    } else {
      existing.avgDailySales7d += p.avgDailySales7d;
    }
  }
  const topProducts = Array.from(templateMap.values())
    .sort((a, b) => b.avgDailySales7d - a.avgDailySales7d)
    .slice(0, 10);

  const dailyData = snapshots.map((s) => ({
    label: new Date(s.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }),
    amount: s.totalRevenue,
    transactions: s.transactionCount,
  }));

  const totalRevenue30d = snapshots.reduce((sum, s) => sum + s.totalRevenue, 0);
  const totalTransactions = snapshots.reduce((sum, s) => sum + s.transactionCount, 0);
  const avgTicket = totalTransactions > 0 ? totalRevenue30d / totalTransactions : 0;

  return { dailyData, topProducts, totalRevenue30d, totalTransactions, avgTicket };
}

export default async function VentasPage() {
  const [salesData, weeklyPattern] = await Promise.all([
    getSalesData().catch(() => ({ dailyData: [] as Awaited<ReturnType<typeof getSalesData>>["dailyData"], topProducts: [] as Awaited<ReturnType<typeof getSalesData>>["topProducts"], totalRevenue30d: 0, totalTransactions: 0, avgTicket: 0 })),
    getWeeklyPattern(60).catch(() => []),
  ]);
  const { dailyData, topProducts, totalRevenue30d, totalTransactions, avgTicket } = salesData;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Analítica de Ventas</h1>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard title="Ingresos mes actual" value={formatCurrency(totalRevenue30d)} icon={DollarSign} variant="success" />
        <KPICard title="Transacciones mes" value={String(totalTransactions)} icon={ShoppingCart} />
        <KPICard title="Ticket Promedio" value={formatCurrency(avgTicket)} icon={TrendingUp} />
        <KPICard title="Productos Activos" value={String(topProducts.length)} subvalue="con ventas recientes" icon={Users} />
      </div>

      <SalesChart data={dailyData} title="Ventas Diarias — Mes Actual" />

      <WeeklyPattern data={weeklyPattern} title="Patrón Semanal — Identifica días débiles" windowDays={60} />

      <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
        <h3 className="text-sm font-semibold">Top 10 Productos por Velocidad de Venta</h3>
        <div className="space-y-2">
          {topProducts.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.category ?? "Sin categoría"}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-primary">{p.avgDailySales7d.toFixed(1)} ud/día</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(p.salePrice)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
