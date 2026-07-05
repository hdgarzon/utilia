"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCampaign } from "../actions";
import { toast } from "sonner";

export function NewCampaignForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    const fd = new FormData();
    fd.set("name", name.trim());
    if (description.trim()) fd.set("description", description.trim());
    if (templateId.trim()) fd.set("templateId", templateId.trim());
    startTransition(async () => {
      const r = await createCampaign(fd);
      if (r.ok) {
        toast.success("Campaña creada como borrador");
        router.push("/campanas");
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl rounded-xl border border-border bg-card p-4 md:p-5 space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="campaign-name" className="text-xs text-muted-foreground">
          Nombre
        </label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          autoFocus
          placeholder="ej. Regreso a clases"
          className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="campaign-description" className="text-xs text-muted-foreground">
          Descripción (opcional)
        </label>
        <textarea
          id="campaign-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
          rows={3}
          placeholder="Objetivo de la campaña, público, oferta…"
          className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="campaign-template" className="text-xs text-muted-foreground">
          Template de WhatsApp (opcional)
        </label>
        <input
          id="campaign-template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          disabled={pending}
          placeholder="ej. promo_regreso_clases"
          className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        La campaña se guarda como borrador. El envío por WhatsApp estará disponible
        cuando se conecte la integración.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Crear campaña
        </button>
        <Link
          href="/campanas"
          className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
