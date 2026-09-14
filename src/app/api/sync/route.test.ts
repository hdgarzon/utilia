import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/sync respondia 200 a cualquier request sin secret, con el estado
 * de los syncs. Un monitor sin el secret correcto veia "OK" sin que se
 * sincronizara nada. Lo que se prueba: sin secret ni sesion es 401 y nunca se
 * dispara el sync. Sesion, Postgres, Odoo y la IA estan mockeados.
 */

const h = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  runFullSync: vi.fn(),
  generateRecommendations: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/sync", () => ({ runFullSync: h.runFullSync }));
vi.mock("@/lib/ai/recommendations", () => ({ generateRecommendations: h.generateRecommendations }));
vi.mock("@/lib/prisma", () => ({ prisma: { syncState: { findMany: h.findMany } } }));

const { GET } = await import("./route");

function get(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/sync", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  h.session = null;
  h.runFullSync.mockReset().mockResolvedValue([]);
  h.generateRecommendations.mockReset().mockResolvedValue({ created: 0 });
  h.findMany.mockReset().mockResolvedValue([{ id: "products" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/sync", () => {
  it("sin secret ni sesion responde 401 y no sincroniza", async () => {
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(h.runFullSync).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("con un secret equivocado responde 401 y no sincroniza", async () => {
    const res = await GET(get("Bearer otro"));
    expect(res.status).toBe(401);
    expect(h.runFullSync).not.toHaveBeenCalled();
  });

  it("sin CRON_SECRET configurado, 'Bearer undefined' no dispara el sync", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await GET(get("Bearer undefined"));
    expect(res.status).toBe(401);
    expect(h.runFullSync).not.toHaveBeenCalled();
  });

  it("con sesion y sin secret devuelve el estado sin sincronizar", async () => {
    h.session = { user: { email: "user@example.com" } };
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ states: [{ id: "products" }], cron: false });
    expect(h.runFullSync).not.toHaveBeenCalled();
  });

  it("con el secret correcto ejecuta el sync y las recomendaciones", async () => {
    const res = await GET(get("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(h.runFullSync).toHaveBeenCalledOnce();
    expect(h.generateRecommendations).toHaveBeenCalledOnce();
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
