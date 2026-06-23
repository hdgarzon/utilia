import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Contenedor estándar de tarjeta/sección del dashboard. Unifica el patrón que
 * antes se repetía inline (`rounded-xl border border-border bg-card p-5`) en ~40
 * lugares: un solo sitio para padding (responsive), borde y radio.
 *
 * Cabecera opcional: ícono + título a la izquierda, `action` a la derecha.
 */
export function SectionCard({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
  noPadding = false,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card",
        !noPadding && "p-4 md:p-5",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="shrink-0 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
            {title && <h3 className="text-sm font-semibold truncate">{title}</h3>}
          </div>
          {action && <div className="shrink-0 text-xs text-muted-foreground">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
