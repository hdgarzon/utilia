"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { setSelectedPeriod } from "@/app/(dashboard)/period-actions";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ALLOWED_PATHS = new Set(["/ventas", "/financiero", "/presupuestos"]);

interface Props {
  month: number;
  year: number;
  realMonth: number;
  realYear: number;
}

export function PeriodSelector({ month, year, realMonth, realYear }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (!ALLOWED_PATHS.has(pathname)) return null;

  // En Presupuestos, un ?month=&year= explícito en la URL le gana a la
  // cookie (preserva links compartibles y el flujo de "Clonar a otro mes",
  // que navega con sus propios parámetros sin pasar por este componente).
  const urlMonth = pathname === "/presupuestos" ? Number(searchParams.get("month")) : null;
  const urlYear = pathname === "/presupuestos" ? Number(searchParams.get("year")) : null;
  const effectiveMonth = urlMonth && urlYear ? urlMonth : month;
  const effectiveYear = urlMonth && urlYear ? urlYear : year;
  const effectiveIsCurrent = effectiveMonth === realMonth && effectiveYear === realYear;

  function go(newMonth: number, newYear: number) {
    startTransition(async () => {
      await setSelectedPeriod(newMonth, newYear);
      if (pathname === "/presupuestos") {
        router.push(`/presupuestos?month=${newMonth}&year=${newYear}`);
      } else {
        router.refresh();
      }
    });
  }

  function prev() {
    const d = new Date(effectiveYear, effectiveMonth - 2, 1);
    go(d.getMonth() + 1, d.getFullYear());
  }

  function next() {
    if (effectiveIsCurrent) return;
    const d = new Date(effectiveYear, effectiveMonth, 1);
    go(d.getMonth() + 1, d.getFullYear());
  }

  function today() {
    go(realMonth, realYear);
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
      <button
        onClick={prev}
        disabled={pending}
        title="Mes anterior"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="font-medium min-w-[92px] text-center">
        {MONTHS[effectiveMonth - 1]} {effectiveYear}
      </span>
      <button
        onClick={next}
        disabled={pending || effectiveIsCurrent}
        title="Mes siguiente"
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {!effectiveIsCurrent && (
        <button
          onClick={today}
          disabled={pending}
          className="ml-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors font-medium"
        >
          Hoy
        </button>
      )}
    </div>
  );
}
