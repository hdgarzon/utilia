"use client";

import { useState, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut } from "lucide-react";
import { navItems, BrandMark } from "./nav-config";

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
  const pathname = usePathname();

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[9999] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-64 flex flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <BrandMark />
              <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="text-white/70 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
              {navItems.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== "/" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-white/15 text-white"
                        : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-white/10 p-3">
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Cerrar sesión
              </button>
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
      className="md:hidden grid h-9 w-9 place-items-center rounded-lg border border-border text-foreground hover:bg-secondary transition-colors"
      aria-label="Abrir menú"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
