"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Flame, Package, Search, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addStatusPostAction, addGanchoAction, suggestGanchoAction } from "@/app/(dashboard)/campanas/status-actions";
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
  const [ganchoOpen, setGanchoOpen] = useState(false);
  const [headline, setHeadline] = useState("");
  const [subhead, setSubhead] = useState("");

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

  function createGancho() {
    if (!headline.trim()) {
      toast.error("El titular no puede estar vacío");
      return;
    }
    setActiveOrigin("gancho");
    startTransition(async () => {
      const r = await addGanchoAction(headline, subhead);
      setActiveOrigin(null);
      if (r.ok) {
        toast.success("Gancho generado");
        setHeadline("");
        setSubhead("");
        setGanchoOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  function suggestGancho() {
    setActiveOrigin("suggest");
    startTransition(async () => {
      const r = await suggestGanchoAction(headline);
      setActiveOrigin(null);
      if (r.ok) {
        setHeadline(r.text.headline);
        setSubhead(r.text.subhead);
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
            <OriginOption
              icon={<Sparkles className="h-4 w-4" />}
              title="Gancho (texto)"
              detail="Un estado de intriga sin producto: titular y subtítulo"
              disabled={pending}
              loading={false}
              onClick={() => {
                setOriginOpen(false);
                setGanchoOpen(true);
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

      <Dialog open={ganchoOpen} onOpenChange={setGanchoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo gancho</DialogTitle>
            <DialogDescription>
              Texto de intriga sin producto. Escribilo vos o pedí una sugerencia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <input
              autoFocus
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Titular de intriga"
              maxLength={60}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold"
            />
            <input
              value={subhead}
              onChange={(e) => setSubhead(e.target.value)}
              placeholder="Subtítulo (opcional)"
              maxLength={90}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                disabled={pending}
                onClick={suggestGancho}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
              >
                {activeOrigin === "suggest" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Sugerir
              </button>
              <button
                disabled={pending || !headline.trim()}
                onClick={createGancho}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {activeOrigin === "gancho" && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Generar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
