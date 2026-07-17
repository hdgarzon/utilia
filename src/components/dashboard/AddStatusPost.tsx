"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Flame, Package, Search, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addStatusPostAction } from "@/app/(dashboard)/campanas/status-actions";
import { ProductPickerDialog, type PickerProduct } from "./ProductPickerDialog";

interface OriginOptionProps {
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

function OriginOption({ icon, title, detail, disabled, loading, onClick }: OriginOptionProps) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-3 text-left hover:bg-secondary disabled:opacity-50"
    >
      <span className="shrink-0 text-muted-foreground">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

export function AddStatusPost({
  liquidacionPool,
  regularPool,
  excludeIds,
}: {
  liquidacionPool: PickerProduct[];
  regularPool: PickerProduct[];
  excludeIds: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  function add(origin: Parameters<typeof addStatusPostAction>[0], label: string) {
    setActiveOrigin(label);
    startTransition(async () => {
      const r = await addStatusPostAction(origin);
      setActiveOrigin(null);
      if (r.ok) {
        toast.success("Estado generado");
        setOriginOpen(false);
        setPickerOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOriginOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Plus className="h-4 w-4" /> Generar otro estado
      </button>

      <Dialog open={originOpen} onOpenChange={setOriginOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generar otro estado</DialogTitle>
            <DialogDescription>¿Qué querés publicar?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <OriginOption
              icon={<Flame className="h-4 w-4" />}
              title="Liquidación"
              detail="El siguiente producto con más capital estancado, con su descuento"
              disabled={pending}
              loading={pending && activeOrigin === "liquidacion"}
              onClick={() => add({ kind: "liquidacion" }, "liquidacion")}
            />
            <OriginOption
              icon={<Package className="h-4 w-4" />}
              title="Producto regular"
              detail="Un producto de buena rotación, sin descuento"
              disabled={pending}
              loading={pending && activeOrigin === "regular"}
              onClick={() => add({ kind: "regular" }, "regular")}
            />
            <OriginOption
              icon={<Search className="h-4 w-4" />}
              title="Elegir producto"
              detail="Buscalo vos en el catálogo"
              disabled={pending}
              loading={false}
              onClick={() => {
                setOriginOpen(false);
                setPickerOpen(true);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        liquidacionPool={liquidacionPool}
        regularPool={regularPool}
        excludeIds={excludeIds}
        onPick={(odooProductId) => add({ kind: "producto", odooProductId }, "producto")}
        pending={pending}
      />
    </>
  );
}
