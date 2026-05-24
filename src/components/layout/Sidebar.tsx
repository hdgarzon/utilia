"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  DollarSign,
  MessageSquare,
  LogOut,
  Zap,
  Tags,
  Wallet,
  BarChart3,
  ShoppingBag,
} from "lucide-react";

const nav = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/ventas", label: "Ventas", icon: TrendingUp },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/abc", label: "ABC / Pareto", icon: BarChart3 },
  { href: "/financiero", label: "Financiero", icon: DollarSign },
  { href: "/presupuestos", label: "Presupuestos", icon: Wallet },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/campanas", label: "Campañas", icon: MessageSquare },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
        <Zap className="h-5 w-5 text-primary" />
        <span className="text-lg font-bold text-primary tracking-tight">UTILIA</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
