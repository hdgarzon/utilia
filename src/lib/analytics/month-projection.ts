export interface MonthEndProjectionInput {
  daysElapsed: number;          // días calendario cerrados (incluye los días sin venta)
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
 * Proyecta el cierre de mes a partir del ritmo de ventas observado (ingreso
 * promedio por día CALENDARIO × días del mes) y el gasto fijo presupuestado del
 * mes completo.
 *
 * El promedio es por día calendario, no por día con venta: si la tienda cierra
 * los domingos, esos días cuentan como cero y la proyección asume la misma
 * proporción de días cerrados para el resto del mes. Promediar solo los días
 * con venta proyectaba ventas también para los domingos.
 *
 * Con el gasto fijo cobrado por día calendario, el margen proyectado es igual
 * al margen real a la fecha; lo que cambia es el monto en pesos.
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
