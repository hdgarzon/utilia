"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navSections } from "./nav-config";

/** Links del menu agrupados por seccion. Lo comparten el sidebar y el menu movil. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      {navSections.map((section, i) => (
        <div key={section.title ?? i} className="space-y-0.5">
          {section.title && (
            <p className="px-3 pb-1.5 text-[11px] font-medium text-muted-foreground/80">{section.title}</p>
          )}
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
