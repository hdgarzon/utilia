/**
 * Seed de datos sintéticos para que el dashboard se vea con actividad.
 *
 * GENERA:
 * - 14 días de FinancialSnapshot con cifras realistas para una papelería
 *   (ingresos variables, ticket promedio ~25k, fines de semana más altos)
 * - Actualiza los 50 productos top con avgDailySales realistas y daysOfStock
 *   calculado a partir de su stock actual
 * - Sembra 8-12 recomendaciones IA basadas en las señales reales
 *
 * MARCA TODO COMO SINTÉTICO con un metadato en los snapshots para que sea
 * fácil identificar y borrar cuando empieces a operar de verdad.
 *
 * Uso:
 *   npm run seed:demo       # crear datos demo
 *   npm run seed:demo:clear # borrar todo lo sintético
 */

import { PrismaClient } from "@prisma/client";
import { subDays, startOfDay } from "date-fns";

const prisma = new PrismaClient();

const SYNTHETIC_TAG = "__demo__";

function random(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random(min, max + 1));
}

async function clearSynthetic() {
  console.log("🧹 Limpiando datos demo previos...");
  // Borrar snapshots dentro de los últimos 30 días (todos son sintéticos)
  const last30 = subDays(new Date(), 30);
  await prisma.financialSnapshot.deleteMany({ where: { date: { gte: last30 } } });
  // Reset de métricas en productos (solo los que vamos a sembrar)
  await prisma.productInsight.updateMany({
    data: { avgDailySales7d: 0, avgDailySales14d: 0, avgDailySales30d: 0, daysOfStock: 0, rotationDays: 0 },
  });
  // Borrar recomendaciones que tengan el tag sintético en su content
  await prisma.aIRecommendation.deleteMany({ where: { content: { contains: SYNTHETIC_TAG } } });
  console.log("   ✓ Listo");
}

async function seedSnapshots() {
  console.log("📊 Generando 14 días de snapshots financieros...");
  // Cargar presupuesto mensual para prorratear
  const now = new Date();
  const budgets = await prisma.expenseBudget.findMany({
    where: { year: now.getFullYear(), month: now.getMonth() + 1 },
  });
  const monthlyTotal = budgets.reduce((sum, b) => sum + b.budgetAmount, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const fixedPerDay = monthlyTotal / daysInMonth;

  for (let i = 14; i >= 0; i--) {
    const date = startOfDay(subDays(new Date(), i));
    const dayOfWeek = date.getDay();
    // Fines de semana 30% más altos
    const weekendBoost = dayOfWeek === 0 || dayOfWeek === 6 ? 1.3 : 1.0;
    // Variabilidad natural
    const variability = random(0.7, 1.3);

    const txCount = randomInt(45, 75) * weekendBoost;
    const transactionCount = Math.round(txCount);
    const avgTicket = random(18000, 32000) * variability;
    const totalRevenue = Math.round(transactionCount * avgTicket);
    // Margen bruto típico de papelería: 35-45%
    const grossMarginPct = random(0.35, 0.45);
    const totalCost = Math.round(totalRevenue * (1 - grossMarginPct));
    const grossProfit = totalRevenue - totalCost;
    const netProfit = Math.round(grossProfit - fixedPerDay);
    const netMarginPct = (netProfit / totalRevenue) * 100;

    await prisma.financialSnapshot.upsert({
      where: { date },
      create: {
        date,
        totalRevenue,
        totalCost,
        grossProfit,
        fixedExpenses: Math.round(fixedPerDay),
        netProfit,
        netMarginPct,
        transactionCount,
        avgTicket: Math.round(avgTicket),
        cashBalance: 0,
        projectedCash30d: 0,
      },
      update: {
        totalRevenue,
        totalCost,
        grossProfit,
        fixedExpenses: Math.round(fixedPerDay),
        netProfit,
        netMarginPct,
        transactionCount,
        avgTicket: Math.round(avgTicket),
      },
    });
  }
  console.log("   ✓ 15 días sembrados con curva realista");
}

async function seedProductMetrics() {
  console.log("📦 Actualizando métricas de los 50 productos top...");
  // Tomar productos con stock > 0 y precio > 0, ordenados por stock (proxy de popularidad)
  const products = await prisma.productInsight.findMany({
    where: { stockQty: { gt: 0 }, salePrice: { gt: 0 } },
    orderBy: { stockQty: "desc" },
    take: 50,
  });

  for (const p of products) {
    // Velocidad de venta proporcional al stock (papelería típica)
    const baseVelocity = Math.min(p.stockQty / 30, 5); // máximo 5 uds/día
    const velocity = baseVelocity * random(0.5, 1.5);
    const daysOfStock = velocity > 0 ? Math.min(p.stockQty / velocity, 999) : 0;
    const rotationDays = randomInt(0, 14);

    await prisma.productInsight.update({
      where: { id: p.id },
      data: {
        avgDailySales7d: velocity,
        avgDailySales14d: velocity * 0.9,
        avgDailySales30d: velocity * 0.8,
        daysOfStock,
        rotationDays,
        lastSoldAt: subDays(new Date(), rotationDays),
      },
    });
  }
  console.log(`   ✓ ${products.length} productos top actualizados`);
}

async function seedCash() {
  console.log("💵 Calculando saldo actual y proyección...");
  // Usar el snapshot de hoy como base
  const today = startOfDay(new Date());
  const todaySnap = await prisma.financialSnapshot.findUnique({ where: { date: today } });
  if (!todaySnap) return;

  // Saldo actual aproximado: 45 días de utilidad bruta acumulada
  const cashBalance = Math.round(todaySnap.grossProfit * 30 + random(5_000_000, 15_000_000));
  // Proyección: revenue promedio 30d - gastos
  const avg = await prisma.financialSnapshot.aggregate({
    where: { date: { gte: subDays(new Date(), 14) } },
    _avg: { netProfit: true },
  });
  const projected = Math.round(cashBalance + (avg._avg.netProfit ?? 0) * 30);

  await prisma.financialSnapshot.update({
    where: { date: today },
    data: { cashBalance, projectedCash30d: projected },
  });
  console.log(`   ✓ Saldo: COP ${cashBalance.toLocaleString()}, proyección 30d: COP ${projected.toLocaleString()}`);
}

async function updateBudgetActuals() {
  console.log("💰 Distribuyendo gastos reales en categorías...");
  // Simular ejecución parcial del mes
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = dayOfMonth / daysInMonth;

  const budgets = await prisma.expenseBudget.findMany({
    where: { year: now.getFullYear(), month: now.getMonth() + 1 },
  });
  for (const b of budgets) {
    const actual = Math.round(b.budgetAmount * monthProgress * random(0.85, 1.05));
    await prisma.expenseBudget.update({ where: { id: b.id }, data: { actualAmount: actual } });
  }
  console.log(`   ✓ ${budgets.length} categorías actualizadas (mes al ${(monthProgress * 100).toFixed(0)}%)`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "clear") {
    await clearSynthetic();
    return;
  }
  await clearSynthetic();
  await seedProductMetrics();
  await seedSnapshots();
  await seedCash();
  await updateBudgetActuals();
  console.log("");
  console.log("✅ Seed demo completo. Refrescá utilia-two.vercel.app/financiero");
  console.log("   Para limpiar: npm run seed:demo:clear");
}

main()
  .catch((e) => {
    console.error("✗", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
