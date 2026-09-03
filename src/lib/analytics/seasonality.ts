import { prisma } from "@/lib/prisma";

/**
 * Indice estacional por categoria.
 *
 * Los FinancialSnapshot agregados ocultan la temporada: papeleria y regalos se
 * cancelan entre si. Medido sobre el historico, en la 2a quincena de diciembre
 * lo escolar cae a 0,52 mientras los regalos suben a 2,36 — con una sola cifra
 * el mes parece normal.
 *
 * El indice compara una quincena contra el promedio de SU MISMO año, para no
 * confundir temporada con crecimiento del negocio (2026 vende ~22% mas que
 * 2025 en general).
 */

/** Quincena de una fecha: "MM-1a" (dias 1-15) o "MM-2a" (16 en adelante). */
export function fortnightKey(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `${iso.slice(5, 7)}-${Number(iso.slice(8, 10)) <= 15 ? "1a" : "2a"}`;
}

/** Quincena en la que cae una fecha futura, para preguntar por la temporada que viene. */
export function fortnightKeyIn(daysAhead: number, from: Date = new Date()): string {
  return fortnightKey(new Date(from.getTime() + daysAhead * 86_400_000));
}

export interface SeasonalIndex {
  category: string;
  fortnight: string;
  index: number; // 1.00 = un dia normal de esa categoria
  years: number; // cuantos años respaldan el dato
  avgDailyRevenue: number;
}

/** Minimo de dias con venta en una quincena para que su promedio sea creible. */
const MIN_DAYS = 5;

/**
 * Calcula el indice de todas las categorias y quincenas con historia suficiente.
 * Devuelve tambien cuantos años respaldan cada dato: con un solo año el indice
 * es una observacion, no un patron, y quien lo consuma debe saberlo.
 */
export async function getSeasonalIndex(): Promise<SeasonalIndex[]> {
  const rows = await prisma.categorySnapshot.findMany({
    select: { date: true, category: true, revenue: true },
    orderBy: { date: "asc" },
  });
  if (rows.length === 0) return [];

  // Promedio diario por categoria y año: la referencia contra la que se compara.
  const porCatAno = new Map<string, { total: number; dias: Set<string> }>();
  for (const r of rows) {
    const iso = r.date.toISOString().slice(0, 10);
    const k = `${r.category}|${iso.slice(0, 4)}`;
    const e = porCatAno.get(k) ?? { total: 0, dias: new Set<string>() };
    e.total += r.revenue;
    e.dias.add(iso);
    porCatAno.set(k, e);
  }
  const base = new Map(
    [...porCatAno].map(([k, v]) => [k, v.dias.size > 0 ? v.total / v.dias.size : 0])
  );

  // Promedio por categoria, quincena y año.
  const porQuincena = new Map<string, { total: number; dias: Set<string> }>();
  for (const r of rows) {
    const iso = r.date.toISOString().slice(0, 10);
    const k = `${r.category}|${fortnightKey(r.date)}|${iso.slice(0, 4)}`;
    const e = porQuincena.get(k) ?? { total: 0, dias: new Set<string>() };
    e.total += r.revenue;
    e.dias.add(iso);
    porQuincena.set(k, e);
  }

  // Promediar los indices de cada año, no las ventas: asi 2025 y 2026 pesan
  // igual aunque el negocio haya crecido entre medias.
  const acum = new Map<string, { suma: number; años: number; rev: number }>();
  for (const [k, v] of porQuincena) {
    if (v.dias.size < MIN_DAYS) continue;
    const [category, fortnight, año] = k.split("|");
    const ref = base.get(`${category}|${año}`);
    if (!ref || ref <= 0) continue;
    const idx = v.total / v.dias.size / ref;
    const kk = `${category}|${fortnight}`;
    const e = acum.get(kk) ?? { suma: 0, años: 0, rev: 0 };
    e.suma += idx;
    e.años += 1;
    e.rev += v.total / v.dias.size;
    acum.set(kk, e);
  }

  return [...acum].map(([kk, v]) => {
    const [category, fortnight] = kk.split("|");
    return {
      category,
      fortnight,
      index: v.suma / v.años,
      years: v.años,
      avgDailyRevenue: v.rev / v.años,
    };
  });
}

/** Indice de una categoria para una quincena, o null si no hay historia. */
export function lookupIndex(
  idx: SeasonalIndex[],
  category: string | null,
  fortnight: string
): SeasonalIndex | null {
  if (!category) return null;
  return idx.find((i) => i.category === category && i.fortnight === fortnight) ?? null;
}

/** Nombre legible de una quincena: "09-2a" → "2.ª quincena de septiembre". */
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
export function fortnightLabel(key: string): string {
  const [mm, parte] = key.split("-");
  return `${parte === "1a" ? "1.ª" : "2.ª"} quincena de ${MESES[Number(mm) - 1] ?? mm}`;
}

export interface SeasonAheadData {
  fortnight: string;
  label: string;
  categories: Array<{ category: string; factor: number; productsBelowMin: number; years: number }>;
}

/**
 * Resumen de la temporada que viene, para la pantalla de reabastecimiento:
 * qué categorías se activan y cuántos de sus productos están por debajo del
 * mínimo ya ajustado.
 */
export async function getSeasonAhead(leadTimeDays: number, coverageDays: number): Promise<SeasonAheadData | null> {
  const idx = await getSeasonalIndex();
  if (idx.length === 0) return null;

  const actual = fortnightKey(new Date());
  const futura = fortnightKeyIn(leadTimeDays + Math.round(coverageDays / 2));

  const porCategoria = await prisma.productInsight.groupBy({
    by: ["category"],
    where: { minStock: { gt: 0 } },
    _count: { _all: true },
  });

  const bajos = await prisma.$queryRaw<Array<{ category: string | null; n: bigint }>>`
    SELECT "category", COUNT(*) n FROM "ProductInsight"
    WHERE "minStock" > 0 AND "stockQty" < "minStock" GROUP BY "category"
  `;
  const bajoPorCat = new Map(bajos.map((b) => [b.category ?? "", Number(b.n)]));

  const categories = porCategoria
    .map((g) => {
      const cat = g.category;
      const ia = lookupIndex(idx, cat, actual)?.index ?? null;
      const info = lookupIndex(idx, cat, futura);
      if (!cat || !ia || !info || ia <= 0) return null;
      return {
        category: cat,
        factor: Math.min(2.5, Math.max(0.5, info.index / ia)),
        productsBelowMin: bajoPorCat.get(cat) ?? 0,
        years: info.years,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return { fortnight: futura, label: fortnightLabel(futura), categories };
}
