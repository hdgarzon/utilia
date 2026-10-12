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
  PackageX,
  ClipboardList,
  Boxes,
  type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Menu agrupado por la pregunta que responde. Doce items sueltos eran una
 * lista para buscar; cinco grupos se leen de un vistazo.
 */
export const navSections: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { href: "/", label: "Resumen", icon: LayoutDashboard },
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
    ],
  },
  {
    title: "Plata",
    items: [
      { href: "/financiero", label: "Financiero", icon: DollarSign },
      { href: "/presupuestos", label: "Presupuestos", icon: Wallet },
    ],
  },
  {
    title: "Inventario",
    items: [
      { href: "/inventario", label: "Inventario", icon: Package },
      { href: "/liquidacion", label: "Liquidación", icon: PackageX },
      { href: "/reabastecimiento", label: "Reabastecimiento", icon: ClipboardList },
      { href: "/compras", label: "Compras", icon: ShoppingBag },
    ],
  },
  {
    title: "Análisis",
    items: [
      { href: "/categorias", label: "Categorías", icon: Tags },
      { href: "/abc", label: "ABC / Pareto", icon: BarChart3 },
    ],
  },
  {
    title: "Catálogo y clientes",
    items: [
      { href: "/productos", label: "Productos", icon: Boxes },
      { href: "/campanas", label: "Campañas", icon: MessageSquare },
    ],
  },
];

export const navItems: NavItem[] = navSections.flatMap((s) => s.items);

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
