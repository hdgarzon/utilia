export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { getWeeklyPattern } from "@/lib/analytics/weekly-pattern";
import { KPICard } from "@/components/dashboard/KPICard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { StockAlert } from "@/components/dashboard/StockAlert";
import { AIFeed } from "@/components/dashboard/AIFeed";
import { WeeklyPattern } from "@/components/dashboard/WeeklyPattern";
import { formatCurrency } from "@/lib/utils";
import {
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
} from "lucide-react";

async function getDashboardData() {
  // Colombia = UTC-5 sin horario de verano. Calcular "hoy" local para que
  // la búsqueda de snapshots coincida con la fecha real del negocio.
  const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowCO = new Date(Date.now() - COLOMBIA_OFFSET_MS);
  const today = new Date(Date.UTC(nowCO.getUTCFullYear(), nowCO.getUTCMonth(), nowCO.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86_400_000);

  const [todaySnapshot, yesterdaySnapshot, criticalStock, aiRecs, hourlyRaw, weeklyPattern] = await Promise.all([
    prisma.financialSnapshot.findUnique({ where: { date: today } }),
    prisma.financialSnapshot.findUnique({ where: { date: yesterday } }),
    prisma.productInsight.findMany({
      where: {
        AND: [
          { avgDailySales7d: { gt: 0 } },
          { daysOfStock: { gt: 0, lt: 7 } },
        ],
      },
      orderBy: { daysOfStock: "asc" },
      take: 10,
    }),
    prisma.aIRecommendation.findMany({
      where: { applied: false, dismissed: false },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 6,
    }),
    odoo.getTodayHourlySales().catch(() => [] as Awaited<ReturnType<typeof odoo.getTodayHourlySales>>),
    getWeeklyPattern(60).catch(() => []),
  ]);

  const salesChange = todaySnapshot && yesterdaySnapshot && yesterdaySnapshot.totalRevenue > 0
    ? ((todaySnapshot.totalRevenue - yesterdaySnapshot.totalRevenue) / yesterdaySnapshot.totalRevenue) * 100
    : 0;

  const ticketChange = todaySnapshot && yesterdaySnapshot && yesterdaySnapshot.avgTicket > 0
    ? ((todaySnapshot.avgTicket - yesterdaySnapshot.avgTicket) / yesterdaySnapshot.avgTicket) * 100
    : 0;

  const hourlyData = hourlyRaw.map((h) => ({
    label: `${String(h.hour).padStart(2, "0")}:00`,
    amount: h.revenue,
    transactions: h.transactions,
  }));

  return {
    today: todaySnapshot,
    salesChange,
    ticketChange,
    criticalStock: criticalStock.map((p) => ({
      id: p.id,
      name: p.name,
      qty: p.stockQty,
      daysOfStock: p.daysOfStock,
      minStock: p.minStock,
    })),
    aiRecs: aiRecs.map((r) => ({
      id: r.id,
      type: r.type,
      priority: r.priority,
      title: r.title,
      content: r.content,
      impact: r.impact ?? undefined,
      applied: r.applied,
      dismissed: r.dismissed,
    })),
    hourlyData,
    weeklyPattern,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData().catch(() => ({
    today: null,
    salesChange: 0,
    ticketChange: 0,
    criticalStock: [] as { id: string; name: string; qty: number; daysOfStock: number; minStock: number }[],
    aiRecs: [] as { id: string; type: string; priority: string; title: string; content: string; impact?: number; applied: boolean; dismissed: boolean }[],
    hourlyData: [] as { label: string; amount: number; transactions: number }[],
    weeklyPattern: [] as Awaited<ReturnType<typeof getWeeklyPattern>>,
  }));
  const { today, salesChange, ticketChange, criticalStock, aiRecs, hourlyData, weeklyPattern } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Resumen Ejecutivo</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Bogota" })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard
          title="Ventas del Día"
          value={formatCurrency(today?.totalRevenue ?? 0)}
          change={salesChange}
          icon={DollarSign}
          variant={today?.totalRevenue ? "success" : "default"}
        />
        <KPICard
          title="Ticket Promedio"
          value={formatCurrency(today?.avgTicket ?? 0)}
          change={ticketChange}
          icon={ShoppingCart}
        />
        <KPICard
          title="Transacciones"
          value={String(today?.transactionCount ?? 0)}
          subvalue="ventas procesadas hoy"
          icon={TrendingUp}
        />
        <KPICard
          title="Utilidad Estimada"
          value={formatCurrency(today?.netProfit ?? 0)}
          subvalue={`Margen: ${((today?.netMarginPct ?? 0)).toFixed(1)}%`}
          icon={Package}
          variant={
            (today?.netMarginPct ?? 0) >= 20 ? "success"
            : (today?.netMarginPct ?? 0) >= 10 ? "warning"
            : "danger"
          }
        />
      </div>

      {criticalStock.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm text-warning font-medium">
            {criticalStock.length} producto{criticalStock.length !== 1 ? "s" : ""} con stock crítico (&lt;7 días)
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Suspense fallback={<div className="h-64 rounded-xl border border-border bg-card animate-pulse" />}>
            <SalesChart data={hourlyData} title="Ventas por Hora — Hoy" />
          </Suspense>
        </div>
        <StockAlert items={criticalStock} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AIFeed recommendations={aiRecs} />
        </div>
        <WeeklyPattern data={weeklyPattern} title="Patrón Semanal" windowDays={60} compact />
      </div>
    </div>
  );
}
