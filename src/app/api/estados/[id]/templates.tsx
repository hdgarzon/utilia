import type { ReactElement } from "react";

export type TemplateId = "A" | "B" | "C";

export interface EstadoData {
  productName: string;
  salePrice: number;
  finalPrice: number;
  discountPct: number;
  copy: string;
  photoSrc: string | null; // data URI PNG, o null → fondo de marca
  logoSrc: string;         // data URI del logo
}

const BLUE = "#0851D4";
const GREEN = "#82FE28";

function fmtCOP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

// A — Impacto máximo (foto a sangre completa)
function TemplateA(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: BLUE }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={1080} height={1920} style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", background: "linear-gradient(to top, rgba(4,16,48,0.92) 0%, rgba(4,16,48,0.15) 45%, rgba(0,0,0,0) 68%)" }} />
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "200px", height: "200px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={176} height={176} style={{ width: "176px", height: "176px", objectFit: "contain" }} alt="Utilia" />
      </div>
      <div style={{ position: "absolute", top: "56px", right: "56px", width: "220px", height: "220px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, borderRadius: "110px", transform: "rotate(8deg)" }}>
        <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>-{Math.round(d.discountPct)}%</div>
      </div>
      <div style={{ position: "absolute", left: "56px", right: "56px", bottom: "72px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{d.productName}</div>
        <div style={{ display: "flex", fontSize: "44px", color: "#cbd5e1", textDecoration: "line-through", marginTop: "20px" }}>Antes {fmtCOP(d.salePrice)}</div>
        <div style={{ display: "flex", fontSize: "140px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
        <div style={{ display: "flex", alignSelf: "flex-start", marginTop: "28px", backgroundColor: BLUE, color: "#fff", fontSize: "40px", fontWeight: 700, padding: "16px 32px", borderRadius: "40px" }}>{d.copy}</div>
      </div>
    </div>
  );
}

// B — Banda azul de marca (foto arriba, banda inferior)
function TemplateB(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: BLUE }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={1080} height={1075} style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1075px", objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1075px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", left: 0, bottom: 0, width: "1080px", height: "845px", backgroundColor: BLUE, display: "flex", flexDirection: "column", justifyContent: "center", padding: "72px" }}>
        <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{d.productName}</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: "28px" }}>
          <div style={{ display: "flex", fontSize: "44px", color: "#c7d2fe", textDecoration: "line-through", marginRight: "24px" }}>{fmtCOP(d.salePrice)}</div>
          <div style={{ display: "flex", fontSize: "128px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
        </div>
        <div style={{ display: "flex", fontSize: "44px", fontWeight: 700, color: GREEN, marginTop: "24px" }}>{d.copy}</div>
      </div>
      <div style={{ position: "absolute", top: "1000px", left: "72px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 800, padding: "18px 40px", borderRadius: "20px", transform: "rotate(-4deg)" }}>-{Math.round(d.discountPct)}% HOY</div>
      <div style={{ position: "absolute", top: "48px", left: "48px", width: "210px", height: "210px", display: "flex", backgroundColor: "#fff", borderRadius: "32px", padding: "12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.logoSrc} width={186} height={186} style={{ width: "186px", height: "186px", objectFit: "contain" }} alt="Utilia" />
      </div>
    </div>
  );
}

// C — Limpio / editorial (fondo blanco, foto enmarcada)
function TemplateC(d: EstadoData): ReactElement {
  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", position: "relative", backgroundColor: "#ffffff" }}>
      {d.photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.photoSrc} width={968} height={1000} style={{ position: "absolute", top: "56px", left: "56px", width: "968px", height: "1000px", objectFit: "cover", borderRadius: "24px" }} alt="" />
      ) : (
        <div style={{ position: "absolute", top: "56px", left: "56px", width: "968px", height: "1000px", borderRadius: "24px", background: `linear-gradient(135deg, ${BLUE}, ${GREEN})` }} />
      )}
      <div style={{ position: "absolute", left: "56px", right: "56px", bottom: "64px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.logoSrc} width={96} height={96} style={{ width: "96px", height: "96px", objectFit: "contain", marginRight: "20px" }} alt="Utilia" />
          <div style={{ display: "flex", fontSize: "34px", fontWeight: 800, color: BLUE, letterSpacing: "4px" }}>LIQUIDACIÓN</div>
        </div>
        <div style={{ display: "flex", fontSize: "58px", fontWeight: 700, color: "#111111", lineHeight: 1.1, marginTop: "24px" }}>{d.productName}</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "40px", color: "#9ca3af", textDecoration: "line-through" }}>{fmtCOP(d.salePrice)}</div>
            <div style={{ display: "flex", fontSize: "120px", fontWeight: 800, color: BLUE, lineHeight: 1 }}>{fmtCOP(d.finalPrice)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: GREEN, color: "#0a2e00", fontSize: "56px", fontWeight: 900, padding: "16px 32px", borderRadius: "20px" }}>-{Math.round(d.discountPct)}%</div>
        </div>
        <div style={{ display: "flex", fontSize: "40px", fontWeight: 800, color: BLUE, marginTop: "24px" }}>{d.copy}</div>
      </div>
    </div>
  );
}

export function renderEstado(template: TemplateId, d: EstadoData): ReactElement {
  if (template === "B") return TemplateB(d);
  if (template === "C") return TemplateC(d);
  return TemplateA(d);
}
