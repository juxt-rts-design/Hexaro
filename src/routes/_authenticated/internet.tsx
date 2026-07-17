import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney } from "@/lib/hexaro";
import { MoovLogo } from "@/components/brand-logos";

export const Route = createFileRoute("/_authenticated/internet")({
  head: () => ({ meta: [{ title: "Internet — Hexaro" }] }),
  component: InternetPage,
});

function InternetPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ sub?: any } | null>(null);

  const { data: subs = [] } = useQuery({
    queryKey: ["internet_subs"],
    queryFn: async () => (await supabase.from("internet_subscriptions").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: forfaits = [] } = useQuery({
    queryKey: ["internet_forfaits"],
    queryFn: async () => (await supabase.from("internet_forfaits").select("*").eq("is_active", true).order("price")).data ?? [],
  });

  const upsert = useMutation({
    mutationFn: async (v: any) => {
      const forfait = forfaits.find((f) => f.id === v.forfait_id);
      const payload = {
        client_name: v.client_name,
        phone: v.phone || null,
        sim_number: v.sim_number || null,
        sim_card: "Moov Africa Gabon",
        forfait_id: v.forfait_id || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: forfait?.duration_days ?? parseInt(v.duration_days) ?? 30,
        price: forfait?.price ?? parseFloat(v.price) ?? 0,
      };
      if (v.id) {
        const { error } = await supabase.from("internet_subscriptions").update(payload).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("internet_subscriptions").insert(payload);
        if (error) throw error;
        if (Number(payload.price) > 0) {
          await supabase.from("payments").insert({ service_slug: "internet", amount: payload.price, reference: `Internet — ${payload.client_name}` });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["internet_subs"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Abonnement enregistré"); setOpen(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("internet_subscriptions").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["internet_subs"] }); toast.success("Supprimé"); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3"><MoovLogo className="h-7 w-auto" /> <span>Internet Moov Africa Gabon</span></span>}
        description={`${subs.length} abonnement(s) actif(s) — tous sur SIM Moov Africa Gabon`}
        actions={
          <Button onClick={() => setOpen({})} className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Nouvel abonnement</Button>
        }
      />

      {subs.length === 0 ? (
        <EmptyState title="Aucun abonnement" description="Créez le premier abonnement Internet Moov." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subs.map((s) => {
            const exp = computeExpiration(s.start_date, s.duration_days);
            return (
              <div key={s.id} className="hex-glass rounded-2xl p-5 group">
                <div className="flex items-start justify-between mb-3">
                  <MoovLogo className="h-6 w-auto" />
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <p className="font-semibold text-lg">{s.client_name}</p>
                <p className="text-xs text-muted-foreground">{s.phone ?? "—"}</p>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>N° SIM : <span className="text-foreground font-mono">{s.sim_number ?? "—"}</span></p>
                  <p>{s.duration_days} jours · {formatMoney(s.price)}</p>
                </div>
                <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen({ sub: s })}><Pencil className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Supprimer ?")) del.mutate(s.id); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && <SubForm initial={open.sub} forfaits={forfaits} onSubmit={(v: any) => upsert.mutate({ ...v, id: open.sub?.id })} submitting={upsert.isPending} />}
      </Dialog>
    </div>
  );
}

function SubForm({ initial, forfaits, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    client_name: initial?.client_name ?? "",
    phone: initial?.phone ?? "",
    sim_number: initial?.sim_number ?? "",
    forfait_id: initial?.forfait_id ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 0),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{initial ? "Modifier l'abonnement" : "Nouvel abonnement Moov"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
        <div className="space-y-2 col-span-2"><Label>Nom du client *</Label><Input required value={v.client_name} onChange={(e) => setV({ ...v, client_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Téléphone</Label><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
        <div className="space-y-2"><Label>N° SIM Moov</Label><Input value={v.sim_number} onChange={(e) => setV({ ...v, sim_number: e.target.value })} placeholder="074 XX XX XX" /></div>
        <div className="space-y-2 col-span-2">
          <Label>Forfait</Label>
          <Select value={v.forfait_id} onValueChange={(val) => setV({ ...v, forfait_id: val })}>
            <SelectTrigger><SelectValue placeholder="Choisir un forfait (ou libre)" /></SelectTrigger>
            <SelectContent>
              {forfaits.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name} — {f.duration_days}j · {formatMoney(f.price)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!v.forfait_id && <>
          <div className="space-y-2"><Label>Durée (j)</Label><Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} /></div>
          <div className="space-y-2"><Label>Prix (F)</Label><Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></div>
        </>}
        <div className="space-y-2 col-span-2"><Label>Date début</Label><Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
        <DialogFooter className="col-span-2"><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Enregistrer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
