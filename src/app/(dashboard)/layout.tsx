import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider, MobileNavTrigger } from "@/components/layout/MobileNav";
import { SyncButton } from "@/components/layout/SyncButton";
import { PeriodSelector } from "@/components/layout/PeriodSelector";
import { getSelectedPeriod } from "@/lib/period";
import { prisma } from "@/lib/prisma";

async function getSyncStatus() {
  try {
    const state = await prisma.syncState.findFirst({
      where: { entity: "pos_order" },
      select: { lastSyncAt: true, status: true },
    });
    return state;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [syncState, period] = await Promise.all([getSyncStatus(), getSelectedPeriod()]);
  const lastSyncLabel = syncState?.lastSyncAt
    ? new Date(syncState.lastSyncAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 md:h-16 md:px-8">
              <MobileNavTrigger />
              <Suspense fallback={null}>
                <PeriodSelector
                  month={period.month}
                  year={period.year}
                  realMonth={period.realMonth}
                  realYear={period.realYear}
                />
              </Suspense>
              <div className="ml-auto flex items-center gap-3">
                {lastSyncLabel && (
                  <span className="hidden sm:inline text-xs text-muted-foreground">
                    Actualizado <span className="text-foreground">{lastSyncLabel}</span>
                  </span>
                )}
                <SyncButton />
              </div>
            </div>
          </header>
          <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-4 md:px-8 md:pt-6">{children}</div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
