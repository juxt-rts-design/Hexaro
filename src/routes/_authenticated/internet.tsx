import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Wifi, Trash2, Pencil, Settings } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney } from "@/lib/hexaro";

export const Route = createFileRoute("/_authenticated/internet")({
  head: () => ({ meta: [{ title: "Internet — Hexaro" }] }),
  component: InternetPage,
});

function InternetPage() {
  const qc = useQueryClient();
  const [openSub, setOpenSub] = useState<any | undefined>(undefined);
  const [openForfaits, setOpenForfaits] = useState(false);

  const { data: subs = [] } = useQuery({
    queryKey: ["internet_subs"],
    queryFn: async () => (await supabase.from("internet_subscriptions").select("*, internet_forfaits(name)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: forfaits = [] } = useQuery({
    queryKey: ["forfaits"],
    queryFn: async () => (await supabase.from("internet_forfaits").select("*").order("duration_days")).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_light"],
    queryFn: async () => (await supabase.from("clients").select("id, first_name, last_name, pseudo").order("first_name")).data ?? [],
  });

  const upsertSub = useMutation({
    mutationFn: async (v: any) => {
      const forfait = forfaits.find((f) => f.id === v.forfait_id);
      const payload = {
        client_id: v.client_id || null,
        client_name: v.client_name,
        phone: v.phone || null,
        sim_card: v.sim_card || null,
        sim_number: v.sim_number || null,
        forfait_id: v.forfait_id || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: forfait?.duration_days ?? parseInt(v.duration_days) ?? 30,
        price: forfait ? Number(forfait.price) : parseFloat(v.price) || 0,
      };
      if (v.id) {
        const { error } = await supabase.from("internet_subscriptions").update(payload).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("internet_subscriptions").insert(payload);
        if (error) throw error;
        if (payload.price > 0) await supabase.from("payments").insert({ service_slug: "internet", client_id: payload.client_id, amount: payload.price, reference: `Internet — ${payload.client_name}` });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["internet_subs"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Enregistré"); setOpenSub(undefined); },
    onError: (e: any) => toast.error(e.message),
  });
  const delSub = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("internet_subscriptions").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["internet_subs"] }); toast.success("Supprimé"); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internet Libertis"
        description={`${subs.length} client(s) SIM · ${forfaits.length} forfait(s)`}
        actions={
          <>
            <Button variant="outline" className="gap-2" onClick={() => setOpenForfaits(true)}><Settings className="h-4 w-4" /> Forfaits</Button>
            <Button className="bg-brand text-brand-foreground gap-2" onClick={() => setOpenSub({})}><Plus className="h-4 w-4" /> Nouveau client SIM</Button>
          </>
        }
      />

      {subs.length === 0 ? (
        <EmptyState title="Aucun abonnement Internet" description="Ajoutez votre premier client SIM Libertis." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {subs.map((s: any) => {
            const exp = computeExpiration(s.start_date, s.duration_days);
            return (
              <div key={s.id} className="hex-glass rounded-2xl p-5 group">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl grid place-items-center bg-warning/20 text-warning"><Wifi className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{s.client_name}</p>
                    <p className="text-xs text-muted-foreground">{s.phone ?? "—"}</p>
                  </div>
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <div className="mt-4 space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Forfait :</span> {s.internet_forfaits?.name ?? `${s.duration_days}j`} · {formatMoney(s.price)}</p>
                  <p><span className="text-muted-foreground">SIM :</span> {s.sim_card ?? "—"} {s.sim_number && `(${s.sim_number})`}</p>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpenSub(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm("Supprimer ?")) delSub.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={openSub !== undefined} onOpenChange={(o) => !o && setOpenSub(undefined)}>
        {openSub !== undefined && (
          <DialogContent>
            <DialogHeader><DialogTitle>{openSub.id ? "Modifier l'abonnement" : "Nouveau client SIM"}</DialogTitle></DialogHeader>
            <SubForm initial={openSub} clients={clients} forfaits={forfaits} onSubmit={(v) => upsertSub.mutate({ ...v, id: openSub.id })} submitting={upsertSub.isPending} />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={openForfaits} onOpenChange={setOpenForfaits}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gestion des forfaits</DialogTitle></DialogHeader>
          <ForfaitsManager forfaits={forfaits} onChange={() => qc.invalidateQueries({ queryKey: ["forfaits"] })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubForm({ initial, clients, forfaits, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    client_id: initial?.client_id ?? "",
    client_name: initial?.client_name ?? "",
    phone: initial?.phone ?? "",
    sim_card: initial?.sim_card ?? "",
    sim_number: initial?.sim_number ?? "",
    forfait_id: initial?.forfait_id ?? forfaits[0]?.id ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
      <div className="space-y-2 col-span-2">
        <Label>Client existant (optionnel)</Label>
        <Select value={v.client_id || "_none"} onValueChange={(x) => {
          const cl = clients.find((c: any) => c.id === x);
          setV({ ...v, client_id: x === "_none" ? "" : x, client_name: cl ? `${cl.first_name} ${cl.last_name ?? ""}`.trim() : v.client_name, phone: cl?.phone ?? v.phone });
        }}>
          <SelectTrigger><SelectValue placeholder="Nouveau client" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Nouveau client</SelectItem>
            {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name ?? ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 col-span-2"><Label>Nom *</Label><Input required value={v.client_name} onChange={(e) => setV({ ...v, client_name: e.target.value })} /></div>
      <div className="space-y-2"><Label>Téléphone</Label><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
      <div className="space-y-2"><Label>Carte SIM</Label><Input value={v.sim_card} onChange={(e) => setV({ ...v, sim_card: e.target.value })} /></div>
      <div className="space-y-2 col-span-2"><Label>Numéro SIM</Label><Input value={v.sim_number} onChange={(e) => setV({ ...v, sim_number: e.target.value })} /></div>
      <div className="space-y-2">
        <Label>Forfait</Label>
        <Select value={v.forfait_id} onValueChange={(x) => setV({ ...v, forfait_id: x })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {forfaits.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name} · {formatMoney(f.price)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label>Date activation</Label><Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
      <DialogFooter className="col-span-2"><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Enregistrer"}</Button></DialogFooter>
    </form>
  );
}

function ForfaitsManager({ forfaits, onChange }: any) {
  const [v, setV] = useState({ name: "", duration_days: "30", price: "5000" });
  async function add() {
    if (!v.name) return;
    const { error } = await supabase.from("internet_forfaits").insert({
      name: v.name, duration_days: parseInt(v.duration_days), price: parseFloat(v.price),
    });
    if (error) return toast.error(error.message);
    toast.success("Forfait créé");
    setV({ name: "", duration_days: "30", price: "5000" });
    onChange();
  }
  async function remove(id: string) {
    if (!confirm("Supprimer ce forfait ?")) return;
    const { error } = await supabase.from("internet_forfaits").delete().eq("id", id);
    if (error) return toast.error(error.message);
    onChange();
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {forfaits.map((f: any) => (
          <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/40">
            <div className="flex-1"><p className="font-medium">{f.name}</p><p className="text-xs text-muted-foreground">{f.duration_days} jours · {formatMoney(f.price)}</p></div>
            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(f.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border">
        <Input placeholder="Nom" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Input type="number" placeholder="Jours" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} />
        <Input type="number" placeholder="Prix" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
      </div>
      <Button onClick={add} className="w-full bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Ajouter un forfait</Button>
    </div>
  );
}
