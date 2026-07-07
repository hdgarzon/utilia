import { cookies } from "next/headers";
import { colombiaYearMonthDay } from "./timezone";

const COOKIE_NAME = "selected_period";

export interface SelectedPeriod {
  month: number;
  year: number;
  isCurrentPeriod: boolean; // true si coincide con el mes real de hoy
  realMonth: number;        // mes real de hoy (Colombia), para el botón "Hoy"
  realYear: number;
}

export interface PeriodUrlOverride {
  month?: string;
  year?: string;
}

/**
 * Única fuente de verdad server-side sobre "qué mes estamos viendo".
 * Prioridad: parámetro de URL explícito (solo Presupuestos lo usa) > cookie
 * compartida > mes real de hoy. La usan el layout y las 3 páginas con
 * navegación de mes (Ventas, Financiero, Presupuestos).
 */
export async function getSelectedPeriod(urlOverride?: PeriodUrlOverride): Promise<SelectedPeriod> {
  const { month: realMonth, year: realYear } = colombiaYearMonthDay();

  let month = realMonth;
  let year = realYear;

  const urlMonth = urlOverride?.month ? Number(urlOverride.month) : null;
  const urlYear = urlOverride?.year ? Number(urlOverride.year) : null;

  if (urlMonth && urlYear) {
    month = urlMonth;
    year = urlYear;
  } else {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (raw) {
      const [y, m] = raw.split("-").map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        year = y;
        month = m;
      }
    }
  }

  return {
    month,
    year,
    isCurrentPeriod: month === realMonth && year === realYear,
    realMonth,
    realYear,
  };
}
