"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, History } from "lucide-react";
import { ImportSheetRow } from "./ImportSheetRow";
import { ImportToolbar, TOKENS_VERDADERO } from "./ImportToolbar";
import { ImportResult } from "./ImportResult";
import { ImportBulkBar } from "./ImportBulkBar";
import { ImportHistory } from "./ImportHistory";
import { validateRow, rowIsCreatable } from "@/lib/products/import-schema";
import { parseDelimited, normalizar, leerNumero } from "@/lib/products/csv-import";
import { saveBatch, createBatchSlice, loadBatch, retryFailedRows } from "@/app/(dashboard)/productos/cargar/actions";
import {
  filaVacia,
  defaultsDeFila,
  aplicarCambio,
  revisarPesoImagenes,
  MAX_ROWS_PER_BATCH,
  CREATE_SLICE_SIZE,
  type ImportRowInput,
  type ImportRowDraft,
  type BatchSummary,
} from "@/lib/products/import-types";
import type { CatalogOptions } from "@/lib/products/types";

const ENCABEZADOS = [
  "Nombre", "Tipo", "Rastreo", "Cantidad", "Precio", "Costo", "Impuesto",
  "Categoría", "Imagen", "Publicado", "Cat. tienda", "Disponibilidad", "PDV", "Proveedor",
  "Mín.", "Máx.", "",
];

export function ImportSheet({ options }: { options: CatalogOptions }) {
  const [nombre, setNombre] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  // Inicializador perezoso: los defaults se calculan una vez al montar, no
  // en cada render, y necesitan el catalogo vivo para resolver el IVA.
  const [filas, setFilas] = useState<ImportRowInput[]>(() => [
    filaVacia(0, defaultsDeFila(options)),
  ]);
  const [guardando, setGuardando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [progreso, setProgreso] = useState<{ ok: number; error: number; faltan: number } | null>(null);
  const [resultado, setResultado] = useState<ImportRowDraft[] | null>(null);
  /**
   * Seleccion para editar en masa, por `clientId` y NO por indice: borrar una
   * fila del medio recorre los indices y la seleccion apuntaria a otras filas
   * sin que nadie lo note.
   */
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [verHistorial, setVerHistorial] = useState(false);
  /** Sube al terminar una carga, para que el historial se recargue. */
  const [versionHistorial, setVersionHistorial] = useState(0);

  const errores = useMemo(
    () => filas.map((f) => validateRow(f, options)),
    [filas, options]
  );
  const conError = errores.filter((e) => !rowIsCreatable(e)).length;

  const defaults = useMemo(() => defaultsDeFila(options), [options]);
  /** Toda fila nueva de la hoja nace por aqui, para que ninguna se salte los defaults. */
  const nuevaFila = (i: number) => filaVacia(i, defaults);

  function cambiar(i: number, cambio: Partial<ImportRowInput>) {
    setFilas((prev) => prev.map((f, j) => (j === i ? aplicarCambio(f, cambio) : f)));
  }

  /** Aplica el mismo cambio a todas las filas marcadas. */
  function cambiarSeleccionadas(cambio: Partial<ImportRowInput>) {
    setFilas((prev) =>
      prev.map((f) => (seleccion.has(f.clientId) ? aplicarCambio(f, cambio) : f))
    );
  }

  function alternarSeleccion(clientId: string) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(clientId)) s.delete(clientId);
      else s.add(clientId);
      return s;
    });
  }

  function alternarTodas() {
    setSeleccion((prev) =>
      prev.size === filas.length ? new Set() : new Set(filas.map((f) => f.clientId))
    );
  }

  function quitar(i: number) {
    // La seleccion se suelta con la fila: si no, un clientId huerfano se
    // queda en el conjunto y la cuenta de "N seleccionadas" miente.
    const fuera = filas[i]?.clientId;
    if (fuera) {
      setSeleccion((prev) => {
        if (!prev.has(fuera)) return prev;
        const s = new Set(prev);
        s.delete(fuera);
        return s;
      });
    }
    setFilas((prev) => prev.filter((_, j) => j !== i).map((f, j) => ({ ...f, rowIndex: j })));
  }


  function agregar() {
    setFilas((prev) =>
      prev.length >= MAX_ROWS_PER_BATCH ? prev : [...prev, nuevaFila(prev.length)]
    );
  }

  /**
   * Pegar desde Excel: si el portapapeles trae varias celdas, se reparte a
   * partir de la fila donde se pego, creando filas si hacen falta.
   *
   * El reparto es POSICIONAL, en el orden de la plantilla (nombre, tipo,
   * rastreo, cantidad, precio, costo, ...). Solo se rellenan las columnas de
   * texto y numero: un id de Odoo no se puede adivinar desde un nombre
   * pegado, asi que categoria, impuesto y proveedor se quedan como estan.
   * Para una lista con las columnas en otro orden esta "Importar CSV", que
   * empareja por encabezado.
   */
  function pegar(e: React.ClipboardEvent, desdeFila: number) {
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return; // una sola celda: comportamiento normal

    let matriz: string[][];
    try {
      // Separador explicito: un pegado desde una hoja de calculo es SIEMPRE
      // TSV, incluso cuando el usuario solo copio una columna de nombres con
      // una coma adentro (p. ej. "Cuaderno, 100 hojas"). Dejar que
      // parseDelimited adivine partiria ese nombre en dos celdas.
      matriz = parseDelimited(texto, "\t");
    } catch {
      // Comilla sin cerrar: no es un pegado multi-celda valido. Se deja que
      // el navegador pegue el texto tal cual en la celda, que es lo que el
      // usuario espera si lo que copio no era una tabla.
      return;
    }
    e.preventDefault();

    // Se cuentan ANTES de tocar el estado, en su propia pasada: el updater de
    // `setFilas` puede correr dos veces (StrictMode) y un contador mutado ahi
    // adentro contaria doble.
    //
    // Y hay que contarlas: una celda ilegible deja el numero como estaba --
    // casi siempre vacio -- y un precio vacio NO es un error de validacion,
    // asi que la fila no se pinta de rojo y el producto se crearia sin precio
    // sin que nadie se entere. Es el mismo aviso que ya da "Importar CSV".
    // Posiciones numericas de la plantilla: cantidad(3), precio(4), costo(5)
    // y, al final, minimo(14) y maximo(15).
    const ilegibles = matriz.reduce(
      (total, cols) =>
        total +
        [cols[3], cols[4], cols[5], cols[14], cols[15]].filter(
          (c) => leerNumero(c) === "invalido"
        ).length,
      0
    );

    setFilas((prev) => {
      const next = [...prev];
      matriz.forEach((cols, k) => {
        const i = desdeFila + k;
        if (i >= MAX_ROWS_PER_BATCH) return;
        if (!next[i]) next[i] = nuevaFila(i);
        // Una celda vacia o ilegible conserva el valor que ya traia la fila
        // en vez de borrarlo o -- como pasaba antes con un `Number(v)` a
        // secas -- escribirle un NaN que Zod rechazaba con un mensaje en
        // ingles sin decir cual fila.
        const num = (v: string | undefined, actual: number | null): number | null => {
          const leido = leerNumero(v);
          return typeof leido === "number" ? leido : actual;
        };
        const txt = (v: string | undefined) => normalizar(v ?? "");

        // Tipo y rastreo llegan como texto libre desde la hoja de calculo.
        // Si la celda viene vacia se conserva lo que ya tenia la fila.
        const tipoPegado = txt(cols[1]);
        const productType: ImportRowInput["productType"] =
          tipoPegado === "servicio" || tipoPegado === "service"
            ? "service"
            : tipoPegado === "combo"
              ? "combo"
              : tipoPegado === "bienes" || tipoPegado === "consu"
                ? "consu"
                : next[i].productType;

        // Odoo solo admite rastreo en bienes: un servicio pegado apaga el
        // rastreo y la cantidad, igual que hace el selector de la fila.
        const esBien = productType === "consu";
        const rastreoPegado = txt(cols[2]);
        const isStorable = !esBien
          ? false
          : rastreoPegado
            ? TOKENS_VERDADERO.has(rastreoPegado)
            : next[i].isStorable;

        next[i] = {
          ...next[i],
          name: cols[0] ?? next[i].name,
          productType,
          isStorable,
          qtyOnHand: esBien ? num(cols[3], next[i].qtyOnHand) : null,
          salePrice: num(cols[4], next[i].salePrice),
          cost: num(cols[5], next[i].cost),
          // Al final de la plantilla, para no correr las columnas de siempre.
          stockMin: esBien ? num(cols[14], next[i].stockMin) : null,
          stockMax: esBien ? num(cols[15], next[i].stockMax) : null,
        };
      });
      return next.map((f, j) => ({ ...f, rowIndex: j }));
    });

    if (ilegibles > 0) {
      toast.warning(
        ilegibles === 1
          ? "1 celda numérica no se pudo leer y quedó vacía. Revísala antes de crear."
          : `${ilegibles} celdas numéricas no se pudieron leer y quedaron vacías. Revísalas antes de crear.`
      );
    }
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast.error("Ponle un nombre al lote para poder guardarlo");
      return;
    }
    // Antes de enviar, no despues: un body pasado de tamaño lo corta la
    // plataforma y del otro lado solo se ve un fallo de red.
    const pesan = revisarPesoImagenes(filas);
    if (pesan) {
      toast.error(pesan);
      return;
    }
    setGuardando(true);
    try {
      const res = await saveBatch({ batchId, name: nombre, rows: filas });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar");
        return;
      }
      setBatchId(res.batchId ?? null);
      toast.success("Borrador guardado");
    } catch (err) {
      console.error("[cargar] la accion de guardar no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Carga el lote otra vez y lo muestra en la pantalla de resultado.
   *
   * Se llama desde TODAS las salidas de crearEnOdoo y reintentar -- exito,
   * una tanda que devuelve error, el tope de vueltas agotado y el catch --
   * para que el usuario siempre vea en que quedo el lote. Antes, cualquier
   * salida que no fuera el camino feliz se saltaba esto: la hoja se quedaba
   * varada sin mostrar que filas ya se habian creado, y la unica accion a la
   * vista era volver a apretar "Crear en Odoo", que chocaba contra las filas
   * ya OK en vez de dejar reintentar solo las que faltaban.
   *
   * Se traga su propio error: si el lote tampoco se puede releer (misma caida
   * de red que probablemente disparo el catch que la llamo), no debe tapar
   * el toast que ya se mostro ni escapar como un rechazo sin capturar.
   */
  async function mostrarResultado(id: string) {
    try {
      const leido = await loadBatch(id);
      if (leido.ok && leido.batch) setResultado(leido.batch.rows);
      // El lote acaba de cambiar de estado: que el historial no muestre lo viejo.
      setVersionHistorial((v) => v + 1);
    } catch (err) {
      console.error("[cargar] no se pudo releer el lote para mostrar el resultado:", err);
    }
  }

  /**
   * Abre un lote del historial.
   *
   * A donde va depende de sus FILAS, no de la etiqueta del lote: si ninguna
   * se creo todavia se abre en la hoja para seguir editando; si alguna ya
   * existe en Odoo se abre el resumen, que trae el reintento de las fallidas
   * y el CSV de cantidades pendientes.
   *
   * Reabrir en la hoja un lote con productos ya creados y darle a "Crear en
   * Odoo" es el camino directo a duplicarlos. `saveBatch` lo rechaza, pero
   * mejor no ofrecer la puerta.
   */
  async function abrirLote(lote: BatchSummary) {
    const hayTrabajo = filas.some((f) => f.name.trim() !== "");
    if (
      hayTrabajo &&
      !window.confirm("Abrir un lote reemplaza lo que hay en la hoja. ¿Continuar?")
    ) {
      return;
    }
    try {
      const leido = await loadBatch(lote.id);
      if (!leido.ok || !leido.batch) {
        toast.error(leido.error ?? "No se pudo abrir el lote");
        return;
      }
      setBatchId(leido.batch.id);
      setNombre(leido.batch.name);
      setSeleccion(new Set());
      setVerHistorial(false);

      if (lote.editable) {
        setResultado(null);
        setFilas(leido.batch.rows.length > 0 ? leido.batch.rows : [nuevaFila(0)]);
      } else {
        setResultado(leido.batch.rows);
      }
    } catch (err) {
      console.error("[cargar] no se pudo abrir el lote:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
    }
  }

  /**
   * Guarda y luego crea por tandas hasta terminar. El bucle vive en el
   * cliente a proposito: cada tanda es su propia server action, asi que
   * ninguna se acerca al limite de tiempo de la funcion.
   */
  async function crearEnOdoo() {
    if (conError > 0) {
      toast.error(`Corrige las ${conError} filas en rojo antes de crear`);
      return;
    }
    if (!nombre.trim()) {
      toast.error("Ponle un nombre al lote");
      return;
    }
    // `crearEnOdoo` empieza guardando, asi que le corre el mismo tope.
    const pesan = revisarPesoImagenes(filas);
    if (pesan) {
      toast.error(pesan);
      return;
    }

    setCreando(true);
    // Variable propia y no el estado `batchId`: dentro de esta misma llamada,
    // el `batchId` del closure no cambia aunque se llame a `setBatchId` -- ese
    // setState solo se ve en el PROXIMO render. El catch necesita el id que
    // se acaba de guardar, no el que habia al empezar.
    let id: string | null = batchId;
    try {
      const guardado = await saveBatch({ batchId, name: nombre, rows: filas });
      if (!guardado.ok || !guardado.batchId) {
        toast.error(guardado.error ?? "No se pudo guardar antes de crear");
        return;
      }
      id = guardado.batchId;
      setBatchId(id);

      // Tope de vueltas: filas / tanda, con margen. Sin el, un `done` que
      // nunca llegue por un bug giraria para siempre.
      const maxVueltas = Math.ceil(MAX_ROWS_PER_BATCH / CREATE_SLICE_SIZE) + 5;
      let termino = false;
      for (let vuelta = 0; vuelta < maxVueltas && !termino; vuelta++) {
        const res = await createBatchSlice(id);
        if (!res.ok || !res.progress) {
          toast.error(res.error ?? "Falló la creación");
          await mostrarResultado(id);
          return;
        }
        setProgreso({
          ok: res.progress.okCount,
          error: res.progress.errorCount,
          faltan: res.progress.remaining,
        });
        termino = res.progress.done;
      }
      // Salir por agotar las vueltas no es terminar. Sin este aviso la
      // pantalla de resultado diria "listo" con filas jamas intentadas.
      if (!termino) {
        toast.error("La creación no terminó: quedan filas sin intentar. Vuelve a darle a Crear en Odoo.");
      }

      await mostrarResultado(id);
    } catch (err) {
      console.error("[cargar] la creacion no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
      if (id) await mostrarResultado(id);
    } finally {
      setCreando(false);
    }
  }

  /**
   * Reintenta las filas que fallaron. NO vuelve a guardar el borrador.
   *
   * Volver a llamar a `saveBatch` aqui seria un error: el lote ya tiene filas
   * en OK, y reenviar la hoja completa haria que una fila cualquiera cayera
   * sobre el indice de un producto ya creado. `saveBatch` solo se llama
   * mientras el lote esta en borrador; despues de crear, el lote persistido
   * ES la verdad y solo hay que seguir procesandolo.
   */
  async function reintentar() {
    if (!batchId) return;
    setCreando(true);
    try {
      // Primero se devuelven a PENDING; si no, createBatchSlice no las mira.
      const reencolado = await retryFailedRows(batchId);
      if (!reencolado.ok) {
        toast.error(reencolado.error ?? "No se pudo preparar el reintento");
        await mostrarResultado(batchId);
        return;
      }

      const maxVueltas = Math.ceil(MAX_ROWS_PER_BATCH / CREATE_SLICE_SIZE) + 5;
      let termino = false;
      for (let vuelta = 0; vuelta < maxVueltas && !termino; vuelta++) {
        const res = await createBatchSlice(batchId);
        if (!res.ok || !res.progress) {
          toast.error(res.error ?? "Falló el reintento");
          await mostrarResultado(batchId);
          return;
        }
        setProgreso({
          ok: res.progress.okCount,
          error: res.progress.errorCount,
          faltan: res.progress.remaining,
        });
        termino = res.progress.done;
      }
      if (!termino) {
        toast.error("El reintento no terminó: quedan filas sin intentar. Vuelve a intentarlo.");
      }
      await mostrarResultado(batchId);
    } catch (err) {
      console.error("[cargar] el reintento no llego al servidor:", err);
      toast.error("No se pudo contactar al servidor. Revisa la conexión.");
      await mostrarResultado(batchId);
    } finally {
      setCreando(false);
    }
  }

  if (resultado) {
    return (
      <ImportResult
        rows={resultado}
        retrying={creando}
        onRetry={reintentar}
        onClose={() => {
          setResultado(null);
          setProgreso(null);
          setBatchId(null);
          setNombre("");
          setSeleccion(new Set());
          setFilas([nuevaFila(0)]);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ImportToolbar
        options={options}
        onRows={(nuevas) => {
          // Importar reemplaza la hoja entera. Si el usuario ya escribio algo
          // y no lo ha guardado, se lo llevaria por delante sin aviso -- y el
          // codigo no puede distinguir "reimporto el archivo corregido" de
          // "acabo de teclear veinte filas".
          const hayTrabajo = filas.some((f) => f.name.trim() !== "");
          if (
            hayTrabajo &&
            !window.confirm("Importar reemplaza todas las filas de la hoja. ¿Continuar?")
          ) {
            return;
          }
          // La hoja entera se reemplaza: los clientId son nuevos y la
          // seleccion vieja apuntaria a filas que ya no existen.
          setSeleccion(new Set());
          setFilas(nuevas.length > 0 ? nuevas : [nuevaFila(0)]);
        }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del lote (ej: Lista Distribuidora — septiembre)"
          aria-label="Nombre del lote"
          className="flex-1 min-w-[240px] rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        />
        <button
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <button
          onClick={crearEnOdoo}
          disabled={creando || guardando || filas.length === 0}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {creando
            ? progreso
              ? `Creando… ${progreso.ok} listos, faltan ${progreso.faltan}`
              : "Creando…"
            : "Crear en Odoo"}
        </button>
        <button
          onClick={() => setVerHistorial((v) => !v)}
          aria-expanded={verHistorial}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
        >
          <History className="h-3.5 w-3.5" /> {verHistorial ? "Ocultar historial" : "Historial"}
        </button>
        <span className="text-xs text-muted-foreground">
          {filas.length} fila{filas.length !== 1 ? "s" : ""}
          {conError > 0 ? ` · ${conError} con error` : ""}
        </span>
      </div>

      {verHistorial ? (
        <ImportHistory onAbrir={abrirLote} recargar={versionHistorial} />
      ) : null}

      {seleccion.size > 0 ? (
        <ImportBulkBar
          cuantas={seleccion.size}
          options={options}
          onAplicar={cambiarSeleccionadas}
          onLimpiar={() => setSeleccion(new Set())}
        />
      ) : null}

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2 px-1 w-6">
                <input
                  type="checkbox"
                  checked={filas.length > 0 && seleccion.size === filas.length}
                  ref={(el) => {
                    // Indeterminado cuando hay seleccion parcial: una casilla
                    // vacia mentiria diciendo que no hay nada marcado.
                    if (el) el.indeterminate = seleccion.size > 0 && seleccion.size < filas.length;
                  }}
                  onChange={alternarTodas}
                  aria-label="Seleccionar todas las filas"
                  className="h-3.5 w-3.5 accent-primary"
                />
              </th>
              {ENCABEZADOS.map((h, i) => (
                <th key={i} className="py-2 px-1 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <ImportSheetRow
                key={f.clientId}
                row={f}
                errors={errores[i]}
                options={options}
                onChange={(cambio) => cambiar(i, cambio)}
                onRemove={() => quitar(i)}
                onPasteRows={(e) => pegar(e, i)}
                seleccionada={seleccion.has(f.clientId)}
                onSeleccionar={() => alternarSeleccion(f.clientId)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Puedes pegar varias filas desde Excel o Google Sheets sobre cualquier celda. Se reparten en el orden de
        la plantilla: nombre, tipo, rastreo, cantidad, precio, costo. Si tu lista trae las columnas en otro
        orden, usa “Importar CSV”, que las empareja por el encabezado.
      </p>

      <button
        onClick={agregar}
        disabled={filas.length >= MAX_ROWS_PER_BATCH}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar fila
      </button>
    </div>
  );
}
