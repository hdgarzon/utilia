import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * El CSV del catalogo WhatsApp lleva precios y catalogo completo: solo con
 * sesion. Sesion, Postgres y el ABC estan mockeados.
 */
const h = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  buildMetaCatalogExport: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/products/meta-catalog-export", () => ({ buildMetaCatalogExport: h.buildMetaCatalogExport }));

const { GET } = await import("./route");

const get = () => new NextRequest("https://utilia.example.com/api/catalog/meta.csv");

beforeEach(() => {
  vi.stubEnv("ODOO_BASE_URL", "https://odoo.example.com/");
  vi.stubEnv("META_CATALOG_PUBLIC_URL", undefined);
  h.session = null;
  h.buildMetaCatalogExport.mockReset().mockResolvedValue({
    csv: "id,title\r\ntmpl-1,Demo\r\n",
    rows: 1,
    byTier: { A: 1, B: 0, C: 0, sin_clase: 0 },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/catalog/meta.csv", () => {
  it("sin sesion responde 401 y no arma el CSV", async () => {
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(h.buildMetaCatalogExport).not.toHaveBeenCalled();
  });

  it("con sesion descarga el CSV y toma las URLs del origen y de Odoo sin barra final", async () => {
    h.session = { user: { email: "user@example.com" } };
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="catalogo-whatsapp-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("x-catalog-rows")).toBe("1");
    expect(await res.text()).toBe("id,title\r\ntmpl-1,Demo\r\n");
    expect(h.buildMetaCatalogExport).toHaveBeenCalledWith({
      publicBaseUrl: "https://utilia.example.com",
      odooBaseUrl: "https://odoo.example.com",
      brand: undefined,
    });
  });
});
