export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { listTemplates, getCatalogOptions, PAGE_SIZE } from "@/lib/products/catalog";
import { CatalogFilters } from "@/components/products/CatalogFilters";
import { CatalogTable } from "@/components/products/CatalogTable";
import type { CatalogFilters as Filters, CatalogProblem, ProductType } from "@/lib/products/types";

const PROBLEMAS_VALIDOS: CatalogProblem[] = [
  "sin_imagen",
  "sin_categoria_web",
  "sin_proveedor",
  "sin_impuesto",
  "sin_publicar",
];
const TIPOS_VALIDOS: ProductType[] = ["consu", "service", "combo"];

function numeroOpcional(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const uno = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : (sp[k] as string | undefined));
  const tipo = uno("tipo");
  const prob = uno("prob");
  const pub = uno("pub");
  return {
    query: uno("q"),
    categoryId: numeroOpcional(uno("cat")),
    publicCategoryId: numeroOpcional(uno("web")),
    type: TIPOS_VALIDOS.includes(tipo as ProductType) ? (tipo as ProductType) : undefined,
    published: pub === "1" ? true : pub === "0" ? false : undefined,
    problem: PROBLEMAS_VALIDOS.includes(prob as CatalogProblem) ? (prob as CatalogProblem) : undefined,
  };
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  let data: Awaited<ReturnType<typeof listTemplates>> | null = null;
  let options: Awaited<ReturnType<typeof getCatalogOptions>> | null = null;
  let error: string | null = null;

  try {
    [data, options] = await Promise.all([listTemplates(filters, page), getCatalogOptions()]);
  } catch (err) {
    console.error("[productos] fallo la lectura del catalogo:", err);
    error = "No se pudo leer el catálogo de Odoo. Revisa la conexión e intenta de nuevo.";
  }

  if (error || !data || !options) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Productos</h1>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Link href="/productos" className="text-xs font-medium text-primary hover:underline">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const qs = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && k !== "page") next.set(k, v);
    }
    next.set("page", String(p));
    return `/productos?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Productos</h1>

      <CatalogFilters options={options} total={data.total} />
      <CatalogTable rows={data.rows} />

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Página {page} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={qs(page - 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary">
                ← Anterior
              </Link>
            )}
            {page < totalPaginas && (
              <Link href={qs(page + 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary">
                Siguiente →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
