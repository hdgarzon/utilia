import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { SyncButton } from "@/components/layout/SyncButton";
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
  const syncState = await getSyncStatus();
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
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
            <MobileNav />
            <div className="flex items-center gap-3">
              {lastSyncLabel && (
                <span className="text-xs text-muted-foreground">
                  Último sync: <span className="text-foreground">{lastSyncLabel}</span>
                </span>
              )}
              <SyncButton />
            </div>
          </div>
        </header>
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
