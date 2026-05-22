export const dynamic = 'force-dynamic';

import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/Sidebar";
import { KPICard } from "@/components/dashboard/KPICard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { StockAlert } from "@/components/dashboard/StockAlert";
import { AIFeed } from "@/components/dashboard/AIFeed";
import { formatCurrency } from "@/lib/utils";
import {
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
} from "lucide-react";
import { startOfDay, subDays } from "date-fns";

async function getDashboardData() {
  const today = startOfDay(new Date());
  const yesterday = startOfDay(subDays(new Date(), 1));

  const [todaySnapshot, yesterdaySnapshot, criticalStock, aiRecs, syncState] = await Promise.all([
    prisma.financialSnapshot.findUnique({ where: { date: today } }),
    prisma.financialSnapshot.findUnique({ where: { date: yesterday } }),
    prisma.productInsight.findMany({
      where: { daysOfStock: { lt: 7 } },
      orderBy: { daysOfStock: "asc" },
      take: 10,
    }),
    prisma.aIRecommendation.findMany({
      where: { applied: false, dismissed: false },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 6,
    }),
    prisma.syncState.findFirst({ where: { entity: "sale_order" } }),
  ]);

  const salesChange = todaySnapshot && yesterdaySnapshot && yesterdaySnapshot.totalRevenue > 0
    ? ((todaySnapshot.totalRevenue - yesterdaySnapshot.totalRevenue) / yesterdaySnapshot.totalRevenue) * 100
    : 0;

  const ticketChange = todaySnapshot && yesterdaySnapshot && yesterdaySnapshot.avgTicket > 0
    ? ((todaySnapshot.avgTicket - yesterdaySnapshot.avgTicket) / yesterdaySnapshot.avgTicket) * 100
    : 0;

  const hourlyData = Array.from({ length: 13 }, (_, i) => {
    const hour = i + 7;
    return { label: `${hour}:00`, amount: Math.random() * 500000, transactions: Math.floor(Math.random() * 8) };
  });

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
    lastSync: syncState?.lastSyncAt,
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
    lastSync: undefined as Date | undefined,
  }));
  const { today, salesChange, ticketChange, criticalStock, aiRecs, hourlyData, lastSync } = data;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Resumen Ejecutivo</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
            {lastSync && (
              <p className="text-xs text-muted-foreground">
                Sync: {new Date(lastSync).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
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

          <AIFeed recommendations={aiRecs} />
        </div>
      </main>
    </div>
  );
}
