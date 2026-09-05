export const dynamic = "force-dynamic";
// Sin esto la funcion serverless de esta ruta corre con el limite por
// defecto de Vercel (muy por debajo de 300s): el comentario del tope de 500
// ids en actions.ts asume este presupuesto. Mismo patron que
// api/sync/route.ts y api/recommendations/generate/route.ts.
export const maxDuration = 300;

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { listTemplates, getCatalogOptions, PAGE_SIZE } from "@/lib/products/catalog";
import { CatalogFilters } from "@/components/products/CatalogFilters";
import { CatalogWorkspace } from "@/components/products/CatalogWorkspace";
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

// La pagina viene de la URL, que es compartible y editable a mano. Un valor
// fraccionario como ?page=1.3 llegaria a Odoo como un offset con decimales, y
// se mostraria tal cual en "Pagina 1.3 de N". Se exige entero positivo.
function paginaValida(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
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
  const page = paginaValida(Array.isArray(sp.page) ? sp.page[0] : sp.page);

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
  // Conserva exactamente el valor que uso parseFilters. Filtrar por
  // `typeof v === "string"` perderia los parametros repetidos (?cat=3&cat=5),
  // que parseFilters SI acepta tomando el primero: la pagina mostraria el
  // filtro aplicado pero el enlace a la siguiente lo dejaria caer.
  const qs = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "page") continue;
      const valor = Array.isArray(v) ? v[0] : v;
      if (valor) next.set(k, valor);
    }
    next.set("page", String(p));
    return `/productos?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Productos</h1>

      <CatalogFilters options={options} total={data.total} />
      <CatalogWorkspace rows={data.rows} options={options} />

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
