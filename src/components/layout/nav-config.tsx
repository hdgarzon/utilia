import {
  LayoutDashboard,
  TrendingUp,
  Package,
  DollarSign,
  MessageSquare,
  Tags,
  Wallet,
  BarChart3,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

export const navItems: { href: string; label: string; icon: LucideIcon }[] = [
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

/**
 * Marca Utilia para la cabecera del sidebar. Wordmark con cuadro lima (acento del
 * logo) + nombre. Para usar el logo real, dejar el PNG en /public y reemplazar
 * el cuadro por <Image src="/logo.png" ... />.
 */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
        U
      </span>
      <div className="leading-none">
        <p className="text-base font-bold tracking-tight text-white">utilia</p>
        <p className="text-[9px] uppercase tracking-[0.15em] text-white/60 mt-0.5">papelería y variedades</p>
      </div>
    </div>
  );
}
