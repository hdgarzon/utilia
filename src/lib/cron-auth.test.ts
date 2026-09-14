import { describe, it, expect } from "vitest";
import { isCronRequest } from "./cron-auth";

function req(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/sync", { headers });
}

describe("isCronRequest", () => {
  it("acepta el bearer con el secret exacto", () => {
    expect(isCronRequest(req("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it("rechaza un secret distinto, de igual o de otro largo", () => {
    expect(isCronRequest(req("Bearer s3creX"), "s3cret")).toBe(false);
    expect(isCronRequest(req("Bearer s3cret-largo"), "s3cret")).toBe(false);
    expect(isCronRequest(req("s3cret"), "s3cret")).toBe(false);
  });

  it("rechaza la request sin header", () => {
    expect(isCronRequest(req(), "s3cret")).toBe(false);
  });

  // El defecto que motivo el helper: sin la variable, la comparacion ingenua
  // contra `Bearer ${process.env.CRON_SECRET}` dejaba pasar este texto.
  it("sin CRON_SECRET no acepta nada, ni siquiera 'Bearer undefined'", () => {
    expect(isCronRequest(req("Bearer undefined"), undefined)).toBe(false);
    expect(isCronRequest(req("Bearer "), "")).toBe(false);
    expect(isCronRequest(req(), undefined)).toBe(false);
  });
});
