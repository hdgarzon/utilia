import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Estas pruebas existen por UN defecto concreto, encontrado en revision:
 *
 * una fila cuyo producto YA se habia creado en Odoo pero cuyo registro local
 * no se pudo guardar se quedaba en PENDING -- indistinguible de una que nunca
 * se intento. Bastaba que otra fila cualquiera fallara para que la pantalla
 * ofreciera "Reintentar", y ese clic corriente la mandaba de vuelta a
 * `createTemplate`: segundo producto real en el Odoo de produccion. Sin
 * carrera, sin proceso muerto, sin nada raro.
 *
 * Por eso lo que se prueba aqui NO es que las funciones devuelvan lo correcto,
 * sino que `createTemplate` no se llame dos veces para la misma fila por
 * ningun camino. Todo lo que sale del proceso -- Postgres, Odoo, la sesion --
 * esta mockeado; la base es un arreglo en memoria.
 */

type Fila = {
  id: string;
  batchId: string;
  rowIndex: number;
  status: string;
  odooTemplateId: number | null;
  error: string | null;
  warning: string | null;
  name: string;
  productType: string;
  isStorable: boolean;
  qtyOnHand: number | null;
  stockMin: number | null;
  stockMax: number | null;
  salePrice: number | null;
  cost: number | null;
  purchaseTaxIds: number[];
  categoryId: number | null;
  imageUrl: string | null;
  imageData: string | null;
  isPublished: boolean;
  publicCategoryIds: number[];
  showAvailability: boolean;
  availableInPos: boolean;
  supplierPartnerId: number | null;
};

const h = vi.hoisted(() => {
  const estado = {
    filas: [] as Fila[],
    /**
     * Simula que falla la escritura que registra el EXITO (la que pone OK con
     * el `odooTemplateId`). Solo esa: es el caso que importa, porque es el
     * unico en el que el producto ya existe en Odoo y la fila todavia no lo
     * sabe. Romper tambien la escritura de ERROR taparia el escenario, porque
     * la tanda cortaria en la primera fila y nunca llegaria a la segunda.
     */
    registroRompe: false,
    /** Traza en orden de lo que va pasando, para probar la secuencia. */
    traza: [] as string[],
  };

  /** Evalua un `where` de Prisma con los campos que usan estas acciones. */
  function coincide(f: Fila, where: Record<string, unknown>): boolean {
    for (const [campo, cond] of Object.entries(where)) {
      const valor = (f as unknown as Record<string, unknown>)[campo];
      if (cond !== null && typeof cond === "object") {
        const { in: dentro, not } = cond as { in?: unknown[]; not?: unknown };
        if (dentro && !dentro.includes(valor)) return false;
        if (not !== undefined && valor === not) return false;
      } else if (valor !== cond) {
        return false;
      }
    }
    return true;
  }

  const filaTabla = {
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      estado.filas
        .filter((f) => coincide(f, where))
        .sort((a, b) => a.rowIndex - b.rowIndex)
        .slice(0, take ?? undefined)
        .map((f) => ({ ...f })),

    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Fila> }) => {
      estado.traza.push(`reclamo:${JSON.stringify(where.status)}`);
      const objetivo = estado.filas.filter((f) => coincide(f, where));
      objetivo.forEach((f) => Object.assign(f, data));
      return { count: objetivo.length };
    },

    update: async ({ where, data }: { where: { id: string }; data: Partial<Fila> }) => {
      estado.traza.push(`registro:${data.status}`);
      if (estado.registroRompe && data.status === "OK") throw new Error("postgres caido");
      const f = estado.filas.find((x) => x.id === where.id);
      if (!f) throw new Error("fila inexistente");
      Object.assign(f, data);
      return { ...f };
    },

    count: async ({ where }: { where: Record<string, unknown> }) =>
      estado.filas.filter((f) => coincide(f, where)).length,

    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const quedan = estado.filas.filter((f) => !coincide(f, where));
      const borradas = estado.filas.length - quedan.length;
      estado.filas = quedan;
      return { count: borradas };
    },

    createMany: async ({
      data,
      skipDuplicates,
    }: {
      data: Array<Partial<Fila> & { batchId: string; rowIndex: number }>;
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const d of data) {
        const choca = estado.filas.some(
          (f) => f.batchId === d.batchId && f.rowIndex === d.rowIndex
        );
        if (choca && skipDuplicates) continue;
        estado.filas.push({ ...filaBase(d.rowIndex, d.batchId), ...d } as Fila);
        count++;
      }
      return { count };
    },
  };

  return { estado, coincide, filaTabla, createTemplate: vi.fn(), createOrderpoint: vi.fn() };
});

function filaBase(rowIndex: number, batchId = "lote1"): Fila {
  return {
    id: `f${rowIndex}`,
    batchId,
    rowIndex,
    status: "PENDING",
    odooTemplateId: null,
    error: null,
    warning: null,
    name: `Producto ${rowIndex}`,
    productType: "consu",
    isStorable: true,
    qtyOnHand: null,
    stockMin: null,
    stockMax: null,
    salePrice: 1000,
    cost: 500,
    purchaseTaxIds: [],
    categoryId: null,
    imageUrl: null,
    imageData: null,
    isPublished: false,
    publicCategoryIds: [],
    showAvailability: false,
    availableInPos: false,
    supplierPartnerId: null,
  };
}

vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/odoo-write", () => ({ translateOdooError: (e: unknown) => String(e) }));
vi.mock("@/lib/products/odoo-catalog-write", () => ({
  createTemplate: h.createTemplate,
  createOrderpoint: h.createOrderpoint,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    productImportBatch: {
      update: async () => ({ id: "lote1", name: "lote" }),
      create: async () => ({ id: "lote1", name: "lote" }),
    },
    productImportRow: h.filaTabla,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ productImportRow: h.filaTabla }),
  },
}));

import { createBatchSlice, retryFailedRows, saveBatch } from "./actions";

function sembrar(cuantas: number) {
  h.estado.filas = Array.from({ length: cuantas }, (_, i) => filaBase(i));
}

beforeEach(() => {
  h.estado.filas = [];
  h.estado.registroRompe = false;
  h.estado.traza = [];
  h.createTemplate.mockReset();
  h.createOrderpoint.mockReset();
});

describe("createBatchSlice", () => {
  it("reclama la fila en Postgres ANTES de llamar a Odoo", async () => {
    sembrar(1);
    h.createTemplate.mockImplementation(async () => {
      h.estado.traza.push("odoo:create");
      return 42;
    });

    await createBatchSlice("lote1");

    // El reclamo primero, y con PENDING en el where: ese literal es lo que
    // hace el update atomico y lo que impide que dos tandas simultaneas se
    // lleven la misma fila.
    expect(h.estado.traza[0]).toBe('reclamo:"PENDING"');
    expect(h.estado.traza[1]).toBe("odoo:create");
    expect(h.estado.filas[0].status).toBe("OK");
    expect(h.estado.filas[0].odooTemplateId).toBe(42);
  });

  it("si no se puede reclamar la fila, no llama a Odoo", async () => {
    sembrar(1);
    // Alguien se la llevo entre el findMany y el reclamo.
    h.estado.filas[0].status = "OK";

    await createBatchSlice("lote1");

    expect(h.createTemplate).not.toHaveBeenCalled();
  });

  it("deja en CREATING la fila creada en Odoo que no se pudo registrar", async () => {
    sembrar(1);
    h.createTemplate.mockResolvedValue(42);
    h.estado.registroRompe = true;

    const r = await createBatchSlice("lote1");

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/42/);
    expect(h.estado.filas[0].status).toBe("CREATING");
  });

  it("marca ERROR, no CREATING, cuando Odoo rechaza: ahi no hay producto que duplicar", async () => {
    sembrar(1);
    h.createTemplate.mockRejectedValue(new Error("nombre repetido"));

    await createBatchSlice("lote1");

    expect(h.estado.filas[0].status).toBe("ERROR");
  });

  it("no cuenta el lote como terminado mientras haya una fila sin confirmar", async () => {
    sembrar(2);
    h.createTemplate.mockResolvedValue(42);
    h.estado.registroRompe = true;
    await createBatchSlice("lote1"); // corta en la primera

    h.estado.registroRompe = false;
    const r = await createBatchSlice("lote1"); // termina la segunda

    expect(r.progress?.remaining).toBe(0);
    expect(r.progress?.unconfirmedCount).toBe(1);
  });
});

describe("una fila sin confirmar no se vuelve a crear en Odoo", () => {
  // El defecto exacto de la revision, de punta a punta.
  it("ni por otra tanda ni por el boton Reintentar", async () => {
    sembrar(2);
    // Fila 0: falla en Odoo (queda ERROR, es la que hace aparecer el boton).
    // Fila 1: se crea en Odoo pero el registro local se cae dos veces.
    h.createTemplate
      .mockRejectedValueOnce(new Error("nombre repetido"))
      .mockResolvedValueOnce(42);
    h.estado.registroRompe = true;

    await createBatchSlice("lote1");

    expect(h.estado.filas[0].status).toBe("ERROR");
    expect(h.estado.filas[1].status).toBe("CREATING");
    expect(h.createTemplate).toHaveBeenCalledTimes(2);

    // Postgres se recupera y el dueño le da a "Reintentar" por la fila 0.
    h.estado.registroRompe = false;
    h.createTemplate.mockResolvedValue(99);

    const reencolado = await retryFailedRows("lote1");
    expect(reencolado.reintentadas).toBe(1); // SOLO la que estaba en ERROR

    await createBatchSlice("lote1");

    // La fila 0 se reintento; la 1 NO se volvio a mandar a Odoo.
    expect(h.estado.filas[0].status).toBe("OK");
    expect(h.estado.filas[1].status).toBe("CREATING");
    expect(h.estado.filas[1].odooTemplateId).toBeNull();
    expect(h.createTemplate).toHaveBeenCalledTimes(3); // 2 + el reintento de la 0
  });

  it("ni porque el borrador se vuelva a guardar encima", async () => {
    sembrar(1);
    h.estado.filas[0].status = "CREATING";

    // Guardar el borrador reemplaza las filas. Si borrara la CREATING, la
    // volveria a meter como PENDING y la proxima tanda recrearia el producto.
    const r = await saveBatch({
      batchId: "lote1",
      name: "lote",
      rows: [
        {
          rowIndex: 0,
          name: "Producto 0",
          productType: "consu" as const,
          isStorable: true,
          qtyOnHand: null,
    stockMin: null,
    stockMax: null,
          salePrice: 1000,
          cost: 500,
          purchaseTaxIds: [],
          categoryId: null,
          imageUrl: null,
          imageData: null,
          isPublished: false,
          publicCategoryIds: [],
          showAvailability: false,
    availableInPos: false,
          supplierPartnerId: null,
        },
      ],
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ya se crearon en Odoo/i);
    expect(h.estado.filas).toHaveLength(1);
    expect(h.estado.filas[0].status).toBe("CREATING");
  });
});

describe("regla de reabastecimiento", () => {
  it("se crea despues del producto, con el id que devolvio Odoo", async () => {
    sembrar(1);
    h.estado.filas[0].stockMin = 2;
    h.estado.filas[0].stockMax = 10;
    h.createTemplate.mockResolvedValue(42);
    h.createOrderpoint.mockResolvedValue(7);

    await createBatchSlice("lote1");

    expect(h.createOrderpoint).toHaveBeenCalledWith(42, 2, 10);
    expect(h.estado.filas[0].status).toBe("OK");
  });

  it("sin minimo y maximo no se crea ninguna regla", async () => {
    sembrar(1);
    h.createTemplate.mockResolvedValue(42);

    await createBatchSlice("lote1");

    expect(h.createOrderpoint).not.toHaveBeenCalled();
  });

  it("si la regla falla, la fila queda OK con aviso -- NO se reintenta el producto", async () => {
    // Es el punto entero de este orden. Marcar ERROR aqui mandaria la fila a
    // "Reintentar" y crearia el producto por segunda vez en Odoo. Quedarse
    // sin la regla es incomparablemente menos grave que duplicar el producto.
    sembrar(1);
    h.estado.filas[0].stockMin = 2;
    h.estado.filas[0].stockMax = 10;
    h.createTemplate.mockResolvedValue(42);
    h.createOrderpoint.mockRejectedValue(new Error("odoo rechazo la regla"));

    await createBatchSlice("lote1");

    expect(h.estado.filas[0].status).toBe("OK");
    expect(h.estado.filas[0].odooTemplateId).toBe(42);
    expect(h.estado.filas[0].warning).toMatch(/mínimos y máximos/i);

    // Y un reintento posterior no lo vuelve a crear.
    await retryFailedRows("lote1");
    await createBatchSlice("lote1");
    expect(h.createTemplate).toHaveBeenCalledTimes(1);
  });
});
