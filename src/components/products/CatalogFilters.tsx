"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { FilterChip } from "@/components/dashboard/table-controls";
import type { CatalogOptions, CatalogProblem } from "@/lib/products/types";

const PROBLEMAS: Array<{ key: CatalogProblem; label: string }> = [
  { key: "sin_imagen", label: "Sin imagen" },
  { key: "sin_categoria_web", label: "Sin categoría web" },
  { key: "sin_proveedor", label: "Sin proveedor" },
  { key: "sin_impuesto", label: "Sin impuesto" },
  { key: "sin_publicar", label: "Sin publicar" },
];

const TIPOS = [
  { key: "consu", label: "Bienes" },
  { key: "service", label: "Servicio" },
  { key: "combo", label: "Combo" },
];

export function CatalogFilters({ options, total }: { options: CatalogOptions; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const paramQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(paramQuery);
  // El input es local para no navegar en cada tecla (la busqueda se dispara
  // al enviar el formulario, ver mas abajo). Pero si el "q" de la URL cambia
  // por otra via -- "Limpiar", Atras/Adelante del navegador -- hay que
  // re-sincronizar, o el input se queda mostrando texto viejo mientras la
  // lista ya cambio. Se ajusta durante el render, no en un efecto, para no
  // pintar un frame de mas con el valor desincronizado.
  const [prevParamQuery, setPrevParamQuery] = useState(paramQuery);
  if (paramQuery !== prevParamQuery) {
    setPrevParamQuery(paramQuery);
    setQuery(paramQuery);
  }

  // Cada cambio de filtro vuelve a la pagina 1: mantener el offset viejo
  // mostraria una pagina vacia cuando el filtro nuevo devuelve menos filas.
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    startTransition(() => router.push(`/productos?${next.toString()}`));
  }

  const problema = params.get("prob");
  const tipo = params.get("tipo");
  const hayFiltros = Array.from(params.keys()).some((k) => k !== "page");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", query);
          }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            aria-label="Buscar productos por nombre o referencia"
            className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs outline-none focus:border-primary"
          />
        </form>

        <select
          value={params.get("cat") ?? ""}
          onChange={(e) => setParam("cat", e.target.value)}
          aria-label="Filtrar por categoría interna"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">Toda categoría</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={params.get("web") ?? ""}
          onChange={(e) => setParam("web", e.target.value)}
          aria-label="Filtrar por categoría de ecommerce"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">Toda categoría web</option>
          {options.publicCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {TIPOS.map((t) => (
          <FilterChip
            key={t.key}
            label={t.label}
            active={tipo === t.key}
            onClick={() => setParam("tipo", tipo === t.key ? null : t.key)}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {PROBLEMAS.map((p) => (
          <FilterChip
            key={p.key}
            label={p.label}
            tone="warning"
            active={problema === p.key}
            onClick={() => setParam("prob", problema === p.key ? null : p.key)}
          />
        ))}
        {hayFiltros && (
          <button
            onClick={() => startTransition(() => router.push("/productos"))}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            <X className="h-3 w-3" /> Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {pending ? "Cargando…" : `${total.toLocaleString("es-CO")} productos`}
        </span>
      </div>
    </div>
  );
}
