import {
  LayoutDashboard,
  TrendingUp,
  DollarSign,
  MessageSquare,
  BarChart3,
  ShoppingBag,
  PackageX,
  ClipboardList,
  Boxes,
  type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Menu agrupado por la pregunta que responde. La auditoria de octubre 2026
 * fusiono Presupuestos en Financiero, Inventario en Reabastecimiento y
 * Categorias en Analisis (ver redirects en next.config.ts): doce items a nueve.
 */
export const navSections: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { href: "/", label: "Resumen", icon: LayoutDashboard },
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
      { href: "/financiero", label: "Financiero", icon: DollarSign },
    ],
  },
  {
    title: "Inventario",
    items: [
      { href: "/reabastecimiento", label: "Reabastecimiento", icon: ClipboardList },
      { href: "/compras", label: "Compras", icon: ShoppingBag },
      { href: "/liquidacion", label: "Liquidación", icon: PackageX },
    ],
  },
  {
    title: "Análisis y catálogo",
    items: [
      { href: "/abc", label: "Análisis", icon: BarChart3 },
      { href: "/productos", label: "Productos", icon: Boxes },
      { href: "/campanas", label: "Campañas", icon: MessageSquare },
    ],
  },
];

export const navItems: NavItem[] = navSections.flatMap((s) => s.items);

/**
 * Marca Utilia para la cabecera del sidebar: cuadro con el acento verde +
 * nombre. Para usar el logo real, dejar el PNG en /public y reemplazar el
 * cuadro por <Image src="/logo.png" ... />.
 */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground text-sm font-semibold">
        U
      </span>
      <div className="leading-none">
        <p className="text-[15px] font-semibold tracking-tight text-foreground">utilia</p>
        <p className="text-[10px] text-muted-foreground mt-1">papelería y variedades</p>
      </div>
    </div>
  );
}
