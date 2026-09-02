export const dynamic = "force-dynamic";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";
import { getWeeklyPattern } from "@/lib/analytics/weekly-pattern";
import { colombiaToday, colombiaYearMonthDay } from "@/lib/timezone";
import { getMonthComparison } from "@/lib/analytics/month-compare";
import { getOpenToBuyPlan } from "@/lib/analytics/open-to-buy";
import { getOpportunities } from "@/lib/analytics/opportunities";
import { getReplenishmentSummary } from "@/lib/analytics/replenishment";
import { KPICard } from "@/components/dashboard/KPICard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { StockAlert } from "@/components/dashboard/StockAlert";
import { AIFeed } from "@/components/dashboard/AIFeed";
import { WeeklyPattern } from "@/components/dashboard/WeeklyPattern";
import { isServiceCategory } from "@/lib/service-categories";
import { formatCurrency, cn } from "@/lib/utils";
import {
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
  ShoppingBag,
  Lightbulb,
  ClipboardList,
  ChevronRight,
} from "lucide-react";

async function getDashboardData() {
  // Colombia = UTC-5 sin horario de verano. Calcular "hoy" local para que
  // la búsqueda de snapshots coincida con la fecha real del negocio.
  const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowCO = new Date(Date.now() - COLOMBIA_OFFSET_MS);
  const today = new Date(Date.UTC(nowCO.getUTCFullYear(), nowCO.getUTCMonth(), nowCO.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86_400_000);

  const [todaySnapshot, yesterdaySnapshot, criticalStock, aiRecs, aiRecsPendingTotal, hourlyRaw, weeklyPattern, todaySold] = await Promise.all([
    prisma.financialSnapshot.findUnique({ where: { date: today } }),
    prisma.financialSnapshot.findUnique({ where: { date: yesterday } }),
    prisma.productInsight.findMany({
      where: {
        avgDailySales7d: { gt: 0 },
        daysOfStock: { lt: 7 },
        stockQty: { gte: 0 },
      },
      orderBy: { daysOfStock: "asc" },
    }),
    prisma.aIRecommendation.findMany({
      where: { applied: false, dismissed: false },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 6,
    }),
    prisma.aIRecommendation.count({ where: { applied: false, dismissed: false } }),
    odoo.getTodayHourlySales().catch(() => [] as Awaited<ReturnType<typeof odoo.getTodayHourlySales>>),
    getWeeklyPattern(60).catch(() => []),
    odoo.getTodaySoldProducts().catch(() => [] as Awaited<ReturnType<typeof odoo.getTodaySoldProducts>>),
  ]);

  const hourlyData = hourlyRaw.map((h) => ({
    label: `${String(h.hour).padStart(2, "0")}:00`,
    amount: h.revenue,
    transactions: h.transactions,
  }));

  // "Hoy" en vivo desde Odoo (misma base —amount_total— que el gráfico horario y
  // que el snapshot del sync). Evita la contradicción de mostrar $0 en los KPIs
  // mientras el gráfico y la tabla ya reflejan ventas del día. Si Odoo no
  // responde (hourly vacío), cae al último snapshot sincronizado.
  const liveRevenue = hourlyData.reduce((s, h) => s + h.amount, 0);
  const liveTransactions = hourlyData.reduce((s, h) => s + h.transactions, 0);
  const isLiveToday = liveTransactions > 0;

  const todayRevenue = isLiveToday ? liveRevenue : (todaySnapshot?.totalRevenue ?? 0);
  const todayTransactions = isLiveToday ? liveTransactions : (todaySnapshot?.transactionCount ?? 0);
  const todayTicket = todayTransactions > 0 ? todayRevenue / todayTransactions : 0;

  const salesChange = yesterdaySnapshot && yesterdaySnapshot.totalRevenue > 0
    ? ((todayRevenue - yesterdaySnapshot.totalRevenue) / yesterdaySnapshot.totalRevenue) * 100
    : 0;
  const ticketChange = yesterdaySnapshot && yesterdaySnapshot.avgTicket > 0
    ? ((todayTicket - yesterdaySnapshot.avgTicket) / yesterdaySnapshot.avgTicket) * 100
    : 0;

  return {
    today: todaySnapshot,
    todayRevenue,
    todayTransactions,
    todayTicket,
    isLiveToday,
    salesChange,
    ticketChange,
    criticalStock: criticalStock
      .filter((p) => !isServiceCategory(p.category))
      .map((p) => ({
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
    aiRecsPendingTotal,
    hourlyData,
    weeklyPattern,
    todaySold,
  };
}

export default async function DashboardPage() {
  const { year: currentYear, month: currentMonth } = colombiaYearMonthDay();
  const [data, monthCmp, otb, opps, replenishment] = await Promise.all([
    getDashboardData().catch(() => ({
      today: null,
      todayRevenue: 0,
      todayTransactions: 0,
      todayTicket: 0,
      isLiveToday: false,
      salesChange: 0,
      ticketChange: 0,
      criticalStock: [] as { id: string; name: string; qty: number; daysOfStock: number; minStock: number }[],
      aiRecs: [] as { id: string; type: string; priority: string; title: string; content: string; impact?: number; applied: boolean; dismissed: boolean }[],
      aiRecsPendingTotal: 0,
      hourlyData: [] as { label: string; amount: number; transactions: number }[],
      weeklyPattern: [] as Awaited<ReturnType<typeof getWeeklyPattern>>,
      todaySold: [] as Awaited<ReturnType<typeof odoo.getTodaySoldProducts>>,
    })),
    getMonthComparison(currentYear, currentMonth).catch(() => null),
    getOpenToBuyPlan().catch(() => null),
    getOpportunities().catch(() => null),
    getReplenishmentSummary().catch(() => null),
  ]);
  const { today, todayRevenue, todayTransactions, todayTicket, isLiveToday, salesChange, ticketChange, criticalStock, aiRecs, aiRecsPendingTotal, hourlyData, weeklyPattern, todaySold } = data;
  const todayUnits = todaySold.reduce((s, p) => s + p.qty, 0);

  // Utilidad del día ESTIMADA sobre la venta en vivo: margen bruto reciente del
  // mes × ingresos de hoy − gasto fijo prorrateado del día. Mantiene coherencia
  // con los ingresos en vivo (no leer un netProfit de un snapshot viejo/ausente).
  const grossMarginPct = monthCmp && monthCmp.current.totalRevenue > 0
    ? monthCmp.current.grossProfit / monthCmp.current.totalRevenue
    : 0;
  const fixedPerDay = monthCmp && monthCmp.current.daysWithData > 0
    ? monthCmp.current.totalFixedExpenses / monthCmp.current.daysWithData
    : 0;
  const todayNet = isLiveToday
    ? todayRevenue * grossMarginPct - fixedPerDay
    : (today?.netProfit ?? 0);
  const todayMargin = todayRevenue > 0 ? (todayNet / todayRevenue) * 100 : 0;

  // Tarjeta de reabastecimiento: lo más urgente manda el mensaje y el color.
  // Un pedido demorado pesa más que la lista por pedir — ese ya salió y no llega.
  const replenishmentSub = !replenishment
    ? "sin datos"
    : replenishment.delayedOrders > 0
      ? `${replenishment.delayedOrders} pedido${replenishment.delayedOrders === 1 ? "" : "s"} demorado${replenishment.delayedOrders === 1 ? "" : "s"}`
      : replenishment.productsToOrder === 0
        ? replenishment.openOrders > 0
          ? `${replenishment.openOrders} pedido${replenishment.openOrders === 1 ? "" : "s"} en camino`
          : "nada por pedir"
        : replenishment.criticalCount > 0
          ? `${replenishment.criticalCount} sin stock esta semana`
          : "productos por reponer";

  const replenishmentTone = !replenishment
    ? "warning"
    : replenishment.delayedOrders > 0 || replenishment.criticalCount > 0
      ? "danger"
      : replenishment.productsToOrder > 0
        ? "warning"
        : "success";

  // Comparación justa: hoy contra un día TÍPICO del mismo día de la semana
  // (promedio de la ventana del patrón semanal). "Vs ayer" genera falsas
  // alarmas: un martes flojo tras un lunes fuerte parece una caída del -60%.
  const todayDow = colombiaToday().getUTCDay(); // 0=Dom … 6=Sáb, coincide con EXTRACT(DOW)
  const typical = weeklyPattern.find((d) => d.dow === todayDow && d.daysObserved > 1);
  const hasTypical = !!typical && typical.avgRevenue > 0;
  const typicalTicket = hasTypical && typical.avgTransactions > 0
    ? typical.avgRevenue / typical.avgTransactions
    : 0;
  const salesChangeShown = hasTypical
    ? ((todayRevenue - typical.avgRevenue) / typical.avgRevenue) * 100
    : salesChange;
  const ticketChangeShown = hasTypical && typicalTicket > 0
    ? ((todayTicket - typicalTicket) / typicalTicket) * 100
    : ticketChange;
  const compareLabel = hasTypical ? `vs ${typical.dayName} típico` : "vs ayer";

  // Centro de mando: la respuesta a las 4 preguntas clave + enlaces al detalle.
  const monthProfit = monthCmp?.current.netProfit ?? 0;
  const monthMargin = monthCmp?.current.netMarginPct ?? 0;
  const monthTone: "success" | "warning" | "danger" = monthProfit <= 0 ? "danger" : monthMargin < 10 ? "warning" : "success";
  const otbInvest = otb?.totals.totalAdjustedInvestment ?? 0;
  const otbCovered = otb ? otb.totals.totalAdjustedInvestment <= otb.reinvestmentFund : true;
  const deadStock = opps?.deadStockTotal ?? 0;
  const deadStockCount = opps?.deadStockCount ?? 0;
  const starCount = opps?.stars.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Resumen Ejecutivo</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Bogota" })}
        </p>
      </div>

      {/* Centro de mando: ¿ganamos? · ¿en qué gastar? · oportunidades · alertas · pedidos */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
        <CommandCard
          href="/financiero"
          label="¿Ganamos? (mes)"
          value={formatCurrency(monthProfit)}
          sub={`Margen ${monthMargin.toFixed(1)}%`}
          icon={<DollarSign className="h-3.5 w-3.5" />}
          tone={monthTone}
        />
        <CommandCard
          href="/compras"
          label="¿En qué gastar?"
          value={formatCurrency(otbInvest)}
          sub={otbCovered ? "el fondo lo cubre" : "revisar capital"}
          icon={<ShoppingBag className="h-3.5 w-3.5" />}
          tone={otbCovered ? "success" : "warning"}
        />
        <CommandCard
          href="/abc"
          label="Oportunidades"
          value={formatCurrency(deadStock)}
          sub={`capital muerto en ${deadStockCount} refs · ${starCount} estrellas`}
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          tone={deadStock > 0 ? "warning" : "success"}
        />
        <CommandCard
          href="/inventario"
          label="Alertas de stock"
          value={String(criticalStock.length)}
          sub="productos críticos"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          tone={criticalStock.length > 0 ? "danger" : "success"}
        />
        <CommandCard
          href="/reabastecimiento"
          label="¿Qué pedir?"
          value={replenishment ? String(replenishment.productsToOrder) : "—"}
          sub={replenishmentSub}
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          tone={replenishmentTone}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPICard
          title="Ventas del Día"
          value={formatCurrency(todayRevenue)}
          change={salesChangeShown}
          changeLabel={compareLabel}
          icon={DollarSign}
          variant={todayRevenue > 0 ? "success" : "default"}
        />
        <KPICard
          title="Ticket Promedio"
          value={formatCurrency(todayTicket)}
          change={ticketChangeShown}
          changeLabel={compareLabel}
          icon={ShoppingCart}
        />
        <KPICard
          title="Transacciones"
          value={String(todayTransactions)}
          subvalue={isLiveToday ? "ventas de hoy (en vivo)" : "ventas procesadas hoy"}
          icon={TrendingUp}
        />
        <KPICard
          title="Utilidad Estimada"
          value={todayRevenue > 0 ? formatCurrency(todayNet) : "—"}
          subvalue={todayRevenue > 0 ? `Margen: ${todayMargin.toFixed(1)}%` : "sin ventas aún hoy"}
          icon={Package}
          variant={
            todayRevenue === 0 ? "default"
            : todayMargin >= 20 ? "success"
            : todayMargin >= 10 ? "warning"
            : "danger"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Suspense fallback={<div className="h-64 rounded-xl border border-border bg-card animate-pulse" />}>
            <SalesChart data={hourlyData} title="Ventas por Hora — Hoy" />
          </Suspense>
        </div>
        <StockAlert items={criticalStock} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Productos vendidos hoy</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {todaySold.length} productos · {todayUnits.toLocaleString("es-CO", { maximumFractionDigits: 1 })} unidades
          </span>
        </div>
        {todaySold.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aún no hay ventas registradas hoy</p>
        ) : (
          <div className="max-h-96 overflow-y-auto -mx-1 px-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-medium w-6">#</th>
                  <th className="text-left py-2 font-medium">Producto</th>
                  <th className="text-right py-2 font-medium whitespace-nowrap">Cantidad</th>
                  <th className="text-right py-2 font-medium">Venta</th>
                </tr>
              </thead>
              <tbody>
                {todaySold.map((p, i) => (
                  <tr key={p.productId} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 font-medium max-w-0 w-full truncate pr-3" title={p.name}>{p.name}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">{p.qty.toLocaleString("es-CO", { maximumFractionDigits: 1 })} ud</td>
                    <td className="py-1.5 text-right font-medium text-primary whitespace-nowrap">{formatCurrency(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AIFeed recommendations={aiRecs} totalPending={aiRecsPendingTotal} />
        </div>
        <WeeklyPattern data={weeklyPattern} title="Patrón Semanal" windowDays={60} compact />
      </div>
    </div>
  );
}

function CommandCard({
  href,
  label,
  value,
  sub,
  icon,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: "success" | "warning" | "danger";
}) {
  const t = tone === "success" ? "text-primary" : tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-card p-4 hover:bg-secondary/30 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={t}>{icon}</span>
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className={cn("text-xl font-bold mt-1", t)}>{value}</p>
      <p className="text-xs text-muted-foreground truncate">{sub}</p>
    </Link>
  );
}
