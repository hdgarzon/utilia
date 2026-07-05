export interface MonthEndProjectionInput {
  daysElapsed: number;          // días del mes con snapshot (incluye hoy si ya sincronizó)
  daysInMonth: number;
  mtdRevenue: number;
  mtdCost: number;
  fixedExpensesMonthly: number; // presupuesto de gastos fijos del mes completo (no prorrateado)
}

export interface MonthEndProjection {
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  mtdRevenue: number;
  projectedRevenue: number;
  projectedCost: number;
  projectedGrossProfit: number;
  fixedExpensesMonthly: number;
  projectedNetProfit: number;
  projectedMarginPct: number;
  lowConfidence: boolean;       // pocos días de historia — la proyección es ruidosa
}

// Con menos de una semana de datos, el ritmo diario observado puede estar
// sesgado por el patrón semanal (ej. si el mes arrancó en fin de semana) y
// proyectarlo ×N días es poco confiable — aun así se muestra, marcado como tal.
const MIN_DAYS_FOR_CONFIDENCE = 7;

/**
 * Proyecta el cierre de mes a partir del ritmo de ventas observado hasta hoy
 * (revenue promedio/día × días del mes) y el gasto fijo presupuestado del mes
 * completo (no solo el prorrateo de los días transcurridos).
 *
 * Por qué existe: mostrar la utilidad MTD cruda como "¿estamos ganando?" hace
 * que los primeros días de cada mes casi siempre se vean en pérdida (pocos
 * días de ingresos contra gastos fijos ya prorrateados) aunque el negocio esté
 * sano. La proyección responde la pregunta real: "a este ritmo, ¿cómo cierro?".
 *
 * Función pura (no consulta la BD): el caller reutiliza datos que ya trajo
 * para otro cálculo, evitando una consulta adicional en paralelo.
 */
export function computeMonthEndProjection(input: MonthEndProjectionInput): MonthEndProjection {
  const { daysElapsed, daysInMonth, mtdRevenue, mtdCost, fixedExpensesMonthly } = input;

  const avgDailyRevenue = daysElapsed > 0 ? mtdRevenue / daysElapsed : 0;
  const costRatio = mtdRevenue > 0 ? mtdCost / mtdRevenue : 0;

  const projectedRevenue = avgDailyRevenue * daysInMonth;
  const projectedCost = projectedRevenue * costRatio;
  const projectedGrossProfit = projectedRevenue - projectedCost;
  const projectedNetProfit = projectedGrossProfit - fixedExpensesMonthly;
  const projectedMarginPct = projectedRevenue > 0 ? (projectedNetProfit / projectedRevenue) * 100 : 0;

  return {
    daysElapsed,
    daysInMonth,
    daysRemaining: Math.max(daysInMonth - daysElapsed, 0),
    mtdRevenue,
    projectedRevenue,
    projectedCost,
    projectedGrossProfit,
    fixedExpensesMonthly,
    projectedNetProfit,
    projectedMarginPct,
    lowConfidence: daysElapsed < MIN_DAYS_FOR_CONFIDENCE,
  };
}
