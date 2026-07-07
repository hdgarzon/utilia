import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { odoo } from "@/lib/odoo";

export const runtime = "nodejs";

const BLUE = "#0851D4";
const GREEN = "#82FE28";

// El logo se lee una vez al cargar el módulo (archivo con espacio en el nombre).
const LOGO_BASE64 = readFileSync(join(process.cwd(), "public", "logo Utilia.jpg")).toString("base64");
const LOGO_SRC = `data:image/jpeg;base64,${LOGO_BASE64}`;

function fmtCOP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await prisma.statusPost.findUnique({ where: { id } });
  if (!post) return new Response("Not found", { status: 404 });

  const img = await odoo.getProductImage(post.odooProductId).catch(() => null);
  const photoSrc = img ? `data:image/png;base64,${img}` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1920px",
          display: "flex",
          position: "relative",
          backgroundColor: BLUE,
        }}
      >
        {photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            width={1080}
            height={1920}
            style={{ position: "absolute", top: 0, left: 0, width: "1080px", height: "1920px", objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1080px",
              height: "1920px",
              background: `linear-gradient(135deg, ${BLUE}, ${GREEN})`,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "1080px",
            height: "1920px",
            background: "linear-gradient(to top, rgba(4,16,48,0.92) 0%, rgba(4,16,48,0.15) 45%, rgba(0,0,0,0) 68%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: "48px",
            left: "48px",
            width: "200px",
            height: "200px",
            display: "flex",
            backgroundColor: "#fff",
            borderRadius: "32px",
            padding: "12px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} width={176} height={176} style={{ width: "176px", height: "176px", objectFit: "contain" }} alt="Utilia" />
        </div>

        <div
          style={{
            position: "absolute",
            top: "56px",
            right: "56px",
            width: "220px",
            height: "220px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: GREEN,
            borderRadius: "110px",
            transform: "rotate(8deg)",
          }}
        >
          <div style={{ display: "flex", fontSize: "84px", fontWeight: 800, color: "#0a2e00" }}>
            -{Math.round(post.discountPct)}%
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: "56px",
            right: "56px",
            bottom: "72px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", fontSize: "60px", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
            {post.productName}
          </div>
          <div style={{ display: "flex", fontSize: "44px", color: "#cbd5e1", textDecoration: "line-through", marginTop: "20px" }}>
            Antes {fmtCOP(post.salePrice)}
          </div>
          <div style={{ display: "flex", fontSize: "140px", fontWeight: 800, color: GREEN, lineHeight: 1 }}>
            {fmtCOP(post.finalPrice)}
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginTop: "28px",
              backgroundColor: BLUE,
              color: "#fff",
              fontSize: "40px",
              fontWeight: 700,
              padding: "16px 32px",
              borderRadius: "40px",
            }}
          >
            {post.copy}
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920 }
  );
}
