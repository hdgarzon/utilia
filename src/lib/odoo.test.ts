/**
 * Fija el comportamiento de `authenticate()` en `src/lib/odoo.ts`.
 *
 * El bug de produccion: en un proceso recien arrancado, `authenticate()`
 * cacheaba el uid resuelto pero no la promesa en vuelo. N llamadas
 * concurrentes que necesitan un uid (p. ej. las 4 lecturas paralelas de
 * `getCatalogOptions`) veian todas `cachedUid === null` y disparaban N
 * peticiones HTTP de autenticacion simultaneas. Odoo.sh responde 429 a esa
 * rafaga.
 *
 * `odoo.ts` lee `process.env.ODOO_*` al cargar el modulo con aserciones de
 * tipo (`!`); no lanzan en runtime si faltan, pero se fijan valores falsos
 * aqui para que el cuerpo de las peticiones sea predecible. Nunca son
 * credenciales reales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface JsonRpcRequestBody {
  params: { service: string; method: string; args: unknown[] };
}

function parseBody(init?: RequestInit): JsonRpcRequestBody {
  return JSON.parse(init?.body as string) as JsonRpcRequestBody;
}

function jsonResponse(result: unknown, opts: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // Dummy: nunca credenciales reales. Alcanza con que existan para que
  // `${ODOO_BASE_URL}/jsonrpc` sea una URL legible en el mock.
  process.env.ODOO_BASE_URL = "https://odoo-test.example.com";
  process.env.ODOO_DB = "db_test";
  process.env.ODOO_LOGIN = "test@example.com";
  process.env.ODOO_API_KEY = "sk_test_dummy";
  // El modulo cachea `cachedUid`/`pendingAuth` en variables de nivel de
  // modulo: sin resetear el registro de modulos, la primera prueba dejaria
  // el uid cacheado para las siguientes.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authenticate: deduplicacion de peticiones concurrentes", () => {
  it("cuatro llamadas concurrentes que necesitan uid producen una sola peticion authenticate", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Cede el hilo antes de responder para que las cuatro llamadas
      // concurrentes alcancen a pedir el uid mientras la primera
      // autenticacion todavia esta en vuelo, igual que en un arranque en
      // frio real contra Odoo.sh.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const body = parseBody(init);
      if (body.params.method === "authenticate") return jsonResponse(7);
      if (body.params.method === "execute_kw") return jsonResponse(0);
      throw new Error(`llamada RPC inesperada: ${body.params.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { odooRpc } = await import("./odoo");

    await Promise.all([
      odooRpc.executeKw("product.template", "search_count", [[]]),
      odooRpc.executeKw("product.template", "search_count", [[]]),
      odooRpc.executeKw("product.template", "search_count", [[]]),
      odooRpc.executeKw("product.template", "search_count", [[]]),
    ]);

    const authenticateCalls = fetchMock.mock.calls.filter(
      ([, init]) => parseBody(init).params.method === "authenticate"
    );
    expect(authenticateCalls).toHaveLength(1);
    // 1 autenticacion + 4 execute_kw = 5 peticiones HTTP en total.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("una autenticacion fallida libera la promesa pendiente para que la siguiente llamada reintente", async () => {
    let authAttempts = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = parseBody(init);
      if (body.params.method === "authenticate") {
        authAttempts += 1;
        // Primer intento: Odoo responde 429, igual que el bug real.
        if (authAttempts === 1) return jsonResponse(null, { status: 429, statusText: "Too Many Requests" });
        return jsonResponse(7);
      }
      if (body.params.method === "execute_kw") return jsonResponse(0);
      throw new Error(`llamada RPC inesperada: ${body.params.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { odooRpc } = await import("./odoo");

    await expect(odooRpc.executeKw("product.template", "search_count", [[]])).rejects.toThrow(/429/);

    // Tras el fallo, una segunda llamada no debe heredar la promesa
    // rechazada anterior: debe reintentar la autenticacion en vez de quedar
    // envenenada para siempre.
    await expect(odooRpc.executeKw("product.template", "search_count", [[]])).resolves.toBe(0);

    expect(authAttempts).toBe(2);
  });
});
