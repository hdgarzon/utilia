import { prisma } from "@/lib/prisma";
import { getABCAnalysis } from "@/lib/analytics/abc";
import { getOpenToBuyPlan } from "@/lib/analytics/open-to-buy";
import { isServiceCategory } from "@/lib/service-categories";

export type SuggestReason = "critico" | "advertencia" | "min_stock";

export interface CandidateProduct {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  daysOfStock: number;
  avgDailySales7d: number;
  cmp: number;
  minStock: number;
}

/**
 * Cantidad sugerida = llevar el stock a `velocidad × cobertura objetivo`,
 * con piso en minStock. Pura para poder verificarla sin BD.
 * Devuelve null si no hay nada que pedir.
 */
export function computeSuggestedQty(
  p: CandidateProduct,
  coverageDays: number
): { qty: number; reason: SuggestReason } | null {
  const toCoverage = p.avgDailySales7d * coverageDays - p.stockQty;
  const toMinStock = p.minStock - p.stockQty;
  const raw = Math.max(toCoverage, toMinStock);
  if (raw <= 0) return null;
  const reason: SuggestReason =
    p.daysOfStock < 7 ? "critico" : p.daysOfStock < 14 ? "advertencia" : "min_stock";
  return { qty: Math.ceil(raw), reason };
}

export interface SupplierRef {
  id: string;
  name: string;
  phone: string | null;
  odooPartnerId: number | null;
}

export interface SuggestionLine {
  odooProductId: number;
  name: string;
  category: string | null;
  stockQty: number;
  daysOfStock: number;
  avgDailySales7d: number;
  suggestedQty: number;
  unitCost: number; // cmp
  tier: "A" | "B" | "C";
  reason: SuggestReason;
}

export interface ReplenishmentSuggestion {
  supplier: SupplierRef | null; // null = grupo "sin proveedor"
  lines: SuggestionLine[];
  totalEstimated: number; // solo líneas A/B (las C no se preseleccionan)
}

export interface PendingLine {
  odooProductId: number;
  productName: string;
  qty: number;
}

export interface PendingOrder {
  id: string;
  status: "APPROVED" | "SENT";
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  odooOrderId: number | null;
  odooOrderName: string | null;
  totalEstimated: number;
  lines: PendingLine[];
  sentAt: Date | null;
  createdAt: Date;
  daysWaiting: number; // desde sentAt (o createdAt si aún no se envía)
  delayed: boolean; // > 7 días enviados sin recibir
}

export interface ReplenishmentPlan {
  coverageDaysTarget: number;
  suggestions: ReplenishmentSuggestion[]; // una por proveedor, orden total desc
  unassigned: ReplenishmentSuggestion;
  totals: {
    lineCount: number; // líneas A/B sugeridas
    criticalCount: number;
    warningCount: number;
    estimated: number; // costo de las líneas A/B
    reinvestmentFund: number;
    gap: number; // estimated - fund (positivo = falta caja)
  };
  pending: PendingOrder[];
}

const DELAY_ALERT_DAYS = 7;

export async function getReplenishmentPlan(coverageDaysTarget = 21): Promise<ReplenishmentPlan> {
  // 1. Candidatos: venden, stock sano, sin regla de no-recompra (>45 días sin venta),
  //    y con hueco de cobertura o por debajo del mínimo.
  const candidates = await prisma.$queryRaw<CandidateProduct[]>`
    SELECT "odooProductId", "name", "category", "stockQty", "daysOfStock",
           "avgDailySales7d", "cmp", "minStock"
    FROM "ProductInsight"
    WHERE "avgDailySales7d" > 0
      AND "stockQty" >= 0
      AND "rotationDays" <= 45
      AND ("daysOfStock" < 14 OR "stockQty" < "minStock")
      AND "name" NOT LIKE '%(archivado)' -- marcador que deja el sync en stubs archivados: no se recompran
    ORDER BY "daysOfStock" ASC
  `;

  // 2. Excluir servicios y productos ya pedidos (pedido abierto en curso).
  const openLines = await prisma.replenishmentLine.findMany({
    where: { order: { status: { in: ["APPROVED", "SENT"] } } },
    select: { odooProductId: true },
  });
  const inFlight = new Set(openLines.map((l) => l.odooProductId));
  const filtered = candidates.filter(
    (c) => !isServiceCategory(c.category) && !inFlight.has(c.odooProductId)
  );

  // 3. Proveedor por producto: override manual > última compra en el historial.
  const overrides = await prisma.productSupplierOverride.findMany({ select: { odooProductId: true, supplierId: true } });
  const overrideByProduct = new Map(overrides.map((o) => [o.odooProductId, o.supplierId]));

  const history = await prisma.$queryRaw<Array<{ odooProductId: number; odooPartnerId: number | null }>>`
    SELECT DISTINCT ON (l."odooProductId") l."odooProductId", p."odooPartnerId"
    FROM "PurchaseOrderLine" l
    JOIN "PurchaseOrder" p ON p.id = l."purchaseOrderId"
    ORDER BY l."odooProductId", p."dateOrder" DESC
  `;
  const partnerByProduct = new Map(
    history.filter((h) => h.odooPartnerId !== null).map((h) => [h.odooProductId, h.odooPartnerId as number])
  );

  const suppliers = await prisma.supplier.findMany({ where: { active: true } });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const supplierByPartner = new Map(
    suppliers.filter((s) => s.odooPartnerId !== null).map((s) => [s.odooPartnerId as number, s])
  );

  // 4. Tier ABC por producto (los que no aparecen en el análisis caen en C).
  const abc = await getABCAnalysis();
  const tierByProduct = new Map(abc.products.map((p) => [p.odooProductId, p.tier]));

  // 5. Armar líneas y agrupar por proveedor.
  const bySupplier = new Map<string, ReplenishmentSuggestion>();
  const unassigned: ReplenishmentSuggestion = { supplier: null, lines: [], totalEstimated: 0 };
  let criticalCount = 0;
  let warningCount = 0;

  for (const c of filtered) {
    const suggestion = computeSuggestedQty(c, coverageDaysTarget);
    if (!suggestion) continue;

    const line: SuggestionLine = {
      odooProductId: c.odooProductId,
      name: c.name,
      category: c.category,
      stockQty: c.stockQty,
      daysOfStock: c.daysOfStock,
      avgDailySales7d: c.avgDailySales7d,
      suggestedQty: suggestion.qty,
      unitCost: c.cmp,
      tier: tierByProduct.get(c.odooProductId) ?? "C",
      reason: suggestion.reason,
    };
    if (line.reason === "critico") criticalCount++;
    if (line.reason === "advertencia") warningCount++;

    const overrideSupplierId = overrideByProduct.get(c.odooProductId);
    const supplier = overrideSupplierId
      ? supplierById.get(overrideSupplierId)
      : (() => {
          const pid = partnerByProduct.get(c.odooProductId);
          return pid !== undefined ? supplierByPartner.get(pid) : undefined;
        })();

    if (!supplier) {
      unassigned.lines.push(line);
      continue;
    }
    let group = bySupplier.get(supplier.id);
    if (!group) {
      group = {
        supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone, odooPartnerId: supplier.odooPartnerId },
        lines: [],
        totalEstimated: 0,
      };
      bySupplier.set(supplier.id, group);
    }
    group.lines.push(line);
  }

  const abTotal = (lines: SuggestionLine[]) =>
    lines.filter((l) => l.tier !== "C").reduce((s, l) => s + l.suggestedQty * l.unitCost, 0);
  for (const g of bySupplier.values()) g.totalEstimated = abTotal(g.lines);
  unassigned.totalEstimated = abTotal(unassigned.lines);

  const suggestions = Array.from(bySupplier.values()).sort((a, b) => b.totalEstimated - a.totalEstimated);

  // 6. Disciplina OTB: comparar contra el Fondo de Reposición.
  const otb = await getOpenToBuyPlan(coverageDaysTarget).catch(() => null);
  const reinvestmentFund = otb?.reinvestmentFund ?? 0;
  const estimated = suggestions.reduce((s, g) => s + g.totalEstimated, 0) + unassigned.totalEstimated;
  const lineCount =
    suggestions.reduce((s, g) => s + g.lines.filter((l) => l.tier !== "C").length, 0) +
    unassigned.lines.filter((l) => l.tier !== "C").length;

  // 7. Pedidos en curso.
  const openOrders = await prisma.replenishmentOrder.findMany({
    where: { status: { in: ["APPROVED", "SENT"] } },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "asc" },
  });
  const nowMs = Date.now();
  const pending: PendingOrder[] = openOrders.map((o) => {
    const since = o.sentAt ?? o.createdAt;
    const daysWaiting = Math.floor((nowMs - since.getTime()) / 86_400_000);
    return {
      id: o.id,
      status: o.status as "APPROVED" | "SENT",
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      supplierPhone: o.supplier.phone,
      odooOrderId: o.odooOrderId,
      odooOrderName: o.odooOrderName,
      totalEstimated: o.totalEstimated,
      lines: o.lines.map((l) => ({ odooProductId: l.odooProductId, productName: l.productName, qty: l.qty })),
      sentAt: o.sentAt,
      createdAt: o.createdAt,
      daysWaiting,
      delayed: o.status === "SENT" && daysWaiting > DELAY_ALERT_DAYS,
    };
  });

  return {
    coverageDaysTarget,
    suggestions,
    unassigned,
    totals: { lineCount, criticalCount, warningCount, estimated, reinvestmentFund, gap: estimated - reinvestmentFund },
    pending,
  };
}
