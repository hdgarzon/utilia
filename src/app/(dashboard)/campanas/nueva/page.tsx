import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NewCampaignForm } from "./NewCampaignForm";

export default function NuevaCampanaPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/campanas"
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary transition-colors"
          aria-label="Volver a campañas"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold">Nueva Campaña</h1>
      </div>
      <NewCampaignForm />
    </div>
  );
}
