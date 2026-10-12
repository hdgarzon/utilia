"use client";

import { useState, createContext, useContext } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark } from "./nav-config";
import { NavLinks } from "./NavLinks";
import { SignOutButton } from "./Sidebar";

const MobileNavContext = createContext<() => void>(() => {});

/**
 * Envuelve todo el layout del dashboard. El overlay del menú se renderiza FUERA
 * del header (que tiene `backdrop-blur`): un elemento con `backdrop-filter` crea
 * un containing block para descendientes `position: fixed`, lo que atrapaba el
 * menú en una cajita pegada al header en vez de cubrir el viewport. Al colgar el
 * overlay como hermano del contenedor principal, `fixed inset-0` se resuelve
 * contra el viewport y `z-[9999]` lo mantiene por encima de todo.
 */
export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[9999] md:hidden">
          <div className="absolute inset-0 bg-foreground/20" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] flex flex-col bg-sidebar text-sidebar-foreground">
            <div className="flex h-16 items-center justify-between px-5">
              <BrandMark />
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
            <div className="p-3">
              <SignOutButton />
            </div>
          </aside>
        </div>
      )}
      <MobileNavContext.Provider value={() => setOpen(true)}>
        {children}
      </MobileNavContext.Provider>
    </>
  );
}

/** Botón hamburguesa que vive dentro del header y abre el menú vía contexto. */
export function MobileNavTrigger() {
  const openMenu = useContext(MobileNavContext);

  return (
    <button
      onClick={openMenu}
      className="md:hidden -ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground hover:bg-secondary transition-colors"
      aria-label="Abrir menú"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
