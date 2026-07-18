import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/confirm-provider";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({ meta: [{ title: "Services — Hexaro" }] }),
  component: ServicesPage,
});

function ServicesPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await supabase.from("services").select("*").order("name")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async (v: any) => {
      const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { error } = await supabase.from("services").insert({
        name: v.name, slug, description: v.description || null,
        default_duration_days: parseInt(v.default_duration_days) || 30,
        default_price: parseFloat(v.default_price) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["services"] }); toast.success("Service créé"); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("services").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["services"] }); toast.success("Supprimé"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="Netflix, Spotify, Internet et vos futurs services numériques (Canva, ChatGPT, Disney+, VPN…)."
        actions={isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Nouveau service</Button></DialogTrigger>
            <ServiceForm onSubmit={(v: any) => create.mutate(v)} submitting={create.isPending} />
          </Dialog>
        )}
      />
      {services.length === 0 ? (
        <EmptyState title="Aucun service" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s) => (
            <div key={s.id} className="hex-glass rounded-2xl p-5 group">
              <div className="flex items-start gap-3">
                <div className="h-11 w-11 rounded-xl grid place-items-center" style={{ backgroundColor: `color-mix(in oklab, ${s.color ?? "var(--brand)"} 20%, transparent)`, color: s.color ?? "var(--brand)" }}>
                  <Package className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{s.name}</p>
                  {s.is_builtin && <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Intégré</p>}
                </div>
                {isAdmin && !s.is_builtin && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100" onClick={async () => { if (await confirmAction({ title: "Supprimer ce service ?", description: s.name, destructive: true, confirmLabel: "Supprimer" })) del.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              {s.description && <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{s.description}</p>}
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.default_duration_days} jours</span>
                <span className="font-semibold hex-gradient-text">{formatMoney(s.default_price)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceForm({ onSubmit, submitting }: any) {
  const [v, setV] = useState({ name: "", description: "", default_duration_days: "30", default_price: "0" });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nouveau service</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label>Nom *</Label><Input required placeholder="Ex : Canva Pro" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description</Label><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={3} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Durée par défaut (j)</Label><Input type="number" min="1" value={v.default_duration_days} onChange={(e) => setV({ ...v, default_duration_days: e.target.value })} /></div>
          <div className="space-y-2"><Label>Prix par défaut</Label><Input type="number" min="0" value={v.default_price} onChange={(e) => setV({ ...v, default_price: e.target.value })} /></div>
        </div>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
