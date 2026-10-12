"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navSections } from "./nav-config";

/** Links del menu agrupados por seccion. Lo comparten el sidebar y el menu movil. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="space-y-4">
      {navSections.map((section, i) => (
        <div key={section.title ?? i} className="space-y-1">
          {section.title && (
            <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
              {section.title}
            </p>
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
        </div>
      ))}
    </div>
  );
}
