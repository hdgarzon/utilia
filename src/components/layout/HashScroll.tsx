"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * El scroll del dashboard vive en <main>, no en la ventana, y el navegador no
 * siempre baja al ancla cuando la seccion llega despues del primer render
 * (p. ej. /categorias -> /abc#categorias). Al cambiar de ruta, si hay hash,
 * se lleva la seccion a la vista en cuanto existe.
 */
export function HashScroll() {
  const pathname = usePathname();
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    // La pagina puede llegar por streaming despues de que monta el layout:
    // se espera a que aparezca la seccion, con un tope de 5 segundos.
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start" });
      return !!el;
    };
    if (tryScroll()) return;
    const observer = new MutationObserver(() => {
      if (tryScroll()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [pathname]);
  return null;
}
