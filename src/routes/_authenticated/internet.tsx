import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Infinity as InfinityIcon, Plus, Shield, Signal, Smartphone, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney, formatDate, bySoonestExpiry } from "@/lib/hexaro";
import { MoovLogo } from "@/components/brand-logos";
import { useConfirm } from "@/components/confirm-provider";
import { recordPayment, syncLatestPaymentAmount, PAYMENT_METHODS } from "@/lib/payments";
import { PaymentFields } from "@/components/payment-fields";
import { MoovPortrait } from "@/lib/moov-portrait";
import { cn } from "@/lib/utils";
import { PageClientFilter, useClientSearch } from "@/components/client-search";
import { clientMatches, searchHaystack } from "@/lib/client-search";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/internet")({
  head: () => ({ meta: [{ title: "Internet Libertis — Hexaro" }] }),
  component: InternetPage,
});

function durationTab(days: number) {
  if (days % 30 === 0) return `${days / 30} MOIS`;
  if (days === 31) return "1 MOIS";
  if (days === 1) return "1 JOUR";
  return `${days} JOURS`;
}

function InternetPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const [open, setOpen] = useState<{ sub?: any } | null>(null);
  const [view, setView] = useState<any | null>(null);
  const { query, openTarget, setOpenTarget } = useClientSearch();

  const { data: subs = [], isPending: subsPending } = useQuery({
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
        if (v.record_payment && Number(payload.price) > 0) {
          await recordPayment({
            service_slug: "internet", amount: Number(payload.price), method: v.method, kind: "renouvellement",
            subscription_id: v.id, subscription_type: "internet_subscriptions", client_name: payload.client_name,
            reference: `Renouvellement Internet — ${payload.client_name}`,
          });
        } else {
          await syncLatestPaymentAmount({
            service_slug: "internet",
            amount: Number(payload.price),
            method: v.method,
            subscription_id: v.id,
            subscription_type: "internet_subscriptions",
            client_name: payload.client_name,
            reference: `Internet — ${payload.client_name}`,
          });
        }
      } else {
        const { data, error } = await supabase.from("internet_subscriptions").insert(payload).select("id").single();
        if (error) throw error;
        if (Number(payload.price) > 0) {
          await recordPayment({
            service_slug: "internet", amount: Number(payload.price), method: v.method, kind: "nouveau",
            subscription_id: data.id, subscription_type: "internet_subscriptions", client_name: payload.client_name,
            reference: `Internet — ${payload.client_name}`,
          });
        }
      }
    },
    onSuccess: (_d, v) => {
      void logActivity({
        action: v.id ? "internet_subscriptions.update" : "internet_subscriptions.insert",
        entity_type: "internet_subscriptions",
        entity_id: v.id,
        metadata: { label: v.client_name },
      });
      qc.invalidateQueries({ queryKey: ["internet_subs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Abonnement enregistré — solde mis à jour");
      setOpen(null);
      setView(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("internet_subscriptions").delete().eq("id", id); if (error) throw error; },
    onSuccess: (_d, id) => {
      void logActivity({ action: "internet_subscriptions.delete", entity_type: "internet_subscriptions", entity_id: id });
      qc.invalidateQueries({ queryKey: ["internet_subs"] }); toast.success("Supprimé"); setView(null);
    },
  });

  const visible = useMemo(
    () => subs.filter((s) => clientMatches(searchHaystack(s.client_name, s.phone, s.sim_number), query)).sort(bySoonestExpiry),
    [subs, query],
  );

  useEffect(() => {
    if (!openTarget || openTarget.slug !== "internet") return;
    const found = subs.find((s) => s.id === openTarget.id);
    if (found) {
      setView(found);
      setOpenTarget(null);
    }
  }, [openTarget, subs, setOpenTarget]);

  const activeCount = subs.filter((s) => computeExpiration(s.start_date, s.duration_days).status !== "expired").length;
  const expiredCount = subs.length - activeCount;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-[#00A2FF]/25 bg-gradient-to-br from-[#051937] via-[#0a2a55] to-[#041225] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-[#00A2FF]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-[#FF6A00]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <MoovLogo className="h-9 w-auto" />
              <span className="inline-block -skew-x-12 bg-[#FF6A00] px-3 py-1 text-xs font-black tracking-widest text-white">LIBERTIS</span>
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-black italic tracking-tight text-white">INTERNET ILLIMITÉ</h1>
            <p className="mt-1 text-sm text-[#9ecfff]">{activeCount} actif(s) · {expiredCount} expiré(s) · {subs.length} SIM Moov Africa Gabon</p>
            <div className="mt-4 flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-wider text-white/80">
              <span className="inline-flex items-center gap-1.5"><InfinityIcon className="h-3.5 w-3.5 text-[#FF6A00]" /> Illimité</span>
              <span className="inline-flex items-center gap-1.5"><Signal className="h-3.5 w-3.5 text-[#FF6A00]" /> Haut débit</span>
              <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-[#FF6A00]" /> Multi-appareils</span>
              <span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[#FF6A00]" /> SIM Libertis</span>
            </div>
          </div>
          <Button onClick={() => setOpen({})} className="bg-[#FF6A00] text-white hover:bg-[#ff8124] gap-2 font-bold">
            <Plus className="h-4 w-4" /> Nouvel abonnement
          </Button>
        </div>
      </div>

      <PageClientFilter
        placeholder="Rechercher un abonné Libertis (nom, téléphone, SIM)…"
        className="border-[#00A2FF]/30 bg-[#071a33] text-white placeholder:text-[#9ecfff] focus:border-[#FF6A00]"
      />

      {subsPending ? null : subs.length === 0 ? (
        <EmptyState title="Aucun abonnement Libertis" description="Créez le premier forfait Internet Moov Africa Gabon." />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun client trouvé" description={`Aucun abonné ne correspond à « ${query.trim()} ».`} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((s) => {
            const exp = computeExpiration(s.start_date, s.duration_days);
            const active = exp.status !== "expired";
            const forfait = forfaits.find((f) => f.id === s.forfait_id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setView(s)}
                className="group text-left overflow-hidden rounded-2xl border border-[#00A2FF]/20 bg-[#071a33] hover:border-[#FF6A00]/70 hover:-translate-y-0.5 transition"
              >
                <div className="flex items-center justify-between px-4 pt-3">
                  <span className="-skew-x-12 bg-[#FF6A00] px-2.5 py-0.5 text-[10px] font-black tracking-widest text-white">
                    {durationTab(s.duration_days)}
                  </span>
                  <span className={cn("text-[11px] font-semibold", active ? "text-[#4ade80]" : "text-[#fb7185]")}>
                    {active ? exp.label : "Expiré"}
                  </span>
                </div>
                <div className="flex items-center gap-4 p-4">
                  <MoovPortrait name={s.client_name} active={active} className="h-16 w-16 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-bold text-white">{s.client_name}</p>
                    <p className="truncate text-sm text-[#9ecfff]">{s.phone || "Sans téléphone"}</p>
                    <p className="mt-1 font-mono text-[11px] text-white/50">SIM {s.sim_number || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-[#FF6A00] px-4 py-2 text-sm font-black text-white">
                  <span>{forfait?.name || "Forfait libre"}</span>
                  <span>{formatMoney(s.price)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view && (
          <SubIdentity
            sub={view}
            forfait={forfaits.find((f) => f.id === view.forfait_id)}
            onEdit={() => { setOpen({ sub: view }); setView(null); }}
            onDelete={async () => {
              if (await confirmAction({ title: "Supprimer l'abonnement ?", description: `L'abonnement de « ${view.client_name} » sera définitivement supprimé.`, destructive: true, confirmLabel: "Supprimer" })) {
                del.mutate(view.id);
              }
            }}
          />
        )}
      </Dialog>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <SubForm
            initial={open.sub}
            forfaits={forfaits}
            onSubmit={(v: any) => upsert.mutate({ ...v, id: open.sub?.id })}
            submitting={upsert.isPending}
            onCancel={() => setOpen(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function SubIdentity({ sub, forfait, onEdit, onDelete }: any) {
  const exp = computeExpiration(sub.start_date, sub.duration_days);
  const fin = new Date(new Date(sub.start_date).getTime() + sub.duration_days * 24 * 60 * 60 * 1000);
  const active = exp.status !== "expired";
  return (
    <DialogContent className="max-w-lg border-[#00A2FF]/20 bg-[#071a33] text-white">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-white">
          <MoovPortrait name={sub.client_name} active={active} className="h-12 w-12" />
          {sub.client_name}
        </DialogTitle>
      </DialogHeader>
      <table className="w-full text-sm">
        <tbody>
          <IdRow label="Client" value={sub.client_name} />
          <IdRow label="Téléphone" value={sub.phone || "—"} />
          <IdRow label="N° SIM Libertis" value={sub.sim_number || "—"} />
          <IdRow label="Forfait" value={forfait?.name || "Libre"} />
          <IdRow label="Début" value={formatDate(sub.start_date)} />
          <IdRow label="Durée" value={durationTab(sub.duration_days)} />
          <IdRow label="Fin" value={formatDate(fin.toISOString())} />
          <tr className="border-b border-white/10">
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-[#9ecfff] w-[42%]">Statut</td>
            <td className={cn("py-2.5 font-medium", active ? "text-[#4ade80]" : "text-[#fb7185]")}>{active ? exp.label : "Expiré"}</td>
          </tr>
          <IdRow label="Montant" value={formatMoney(sub.price)} />
        </tbody>
      </table>
      <DialogFooter className="bg-[#071a33] sm:justify-between">
        <Button type="button" variant="ghost" className="text-[#fb7185]" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-1" /> Supprimer
        </Button>
        <Button type="button" onClick={onEdit} className="bg-[#FF6A00] text-white hover:bg-[#ff8124] gap-1">
          <Pencil className="h-4 w-4" /> Modifier
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-white/10">
      <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-[#9ecfff] w-[42%]">{label}</td>
      <td className="py-2.5 font-medium text-white">{value}</td>
    </tr>
  );
}

function SubForm({ initial, forfaits, onSubmit, submitting, onCancel }: any) {
  const [v, setV] = useState({
    client_name: initial?.client_name ?? "",
    phone: initial?.phone ?? "",
    sim_number: initial?.sim_number ?? "",
    forfait_id: initial?.forfait_id ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 0),
    method: PAYMENT_METHODS[0]!.value as string,
    record_payment: false,
  });

  return (
    <DialogContent className="border-[#00A2FF]/20 bg-[#071a33] text-white">
      <DialogHeader>
        <DialogTitle className="uppercase tracking-wide text-white">{initial ? "Modifier l'abonné" : "Nouvel abonné Libertis"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex items-center gap-3 rounded-xl border border-[#FF6A00]/40 bg-[#051937] p-3">
          <MoovPortrait name={v.client_name || "?"} className="h-12 w-12" />
          <p className="text-sm text-[#9ecfff]">Profil vivant — couleurs uniques par abonné</p>
        </div>
        <div className="space-y-2 col-span-2">
          <Label className="text-[#9ecfff]">Nom du client *</Label>
          <Input required value={v.client_name} onChange={(e) => setV({ ...v, client_name: e.target.value })} className="bg-[#051937] border-[#00A2FF]/30 text-white" />
        </div>
        <div className="space-y-2">
          <Label className="text-[#9ecfff]">Téléphone</Label>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} className="bg-[#051937] border-[#00A2FF]/30 text-white" />
        </div>
        <div className="space-y-2">
          <Label className="text-[#9ecfff]">N° SIM Libertis</Label>
          <Input value={v.sim_number} onChange={(e) => setV({ ...v, sim_number: e.target.value })} placeholder="074 XX XX XX" className="bg-[#051937] border-[#00A2FF]/30 text-white" />
        </div>
        <div className="space-y-2 col-span-2">
          <Label className="text-[#9ecfff]">Forfait</Label>
          <Select value={v.forfait_id} onValueChange={(val) => setV({ ...v, forfait_id: val })}>
            <SelectTrigger className="bg-[#051937] border-[#00A2FF]/30 text-white"><SelectValue placeholder="Choisir un forfait (ou libre)" /></SelectTrigger>
            <SelectContent>
              {forfaits.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name} — {f.duration_days}j · {formatMoney(f.price)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!v.forfait_id && (
          <>
            <div className="space-y-2"><Label className="text-[#9ecfff]">Durée (j)</Label><Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} className="bg-[#051937] border-[#00A2FF]/30 text-white" /></div>
            <div className="space-y-2"><Label className="text-[#9ecfff]">Prix (F)</Label><Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className="bg-[#051937] border-[#00A2FF]/30 text-white" /></div>
          </>
        )}
        <div className="space-y-2 col-span-2">
          <Label className="text-[#9ecfff]">Date début</Label>
          <Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} className="bg-[#051937] border-[#00A2FF]/30 text-white" />
        </div>
        <PaymentFields isEdit={!!initial} method={v.method} onMethod={(m) => setV({ ...v, method: m })} recordPayment={v.record_payment} onRecordPayment={(b) => setV({ ...v, record_payment: b })} />
        <DialogFooter className="col-span-2 bg-[#071a33] sm:justify-between">
          <Button type="button" variant="outline" onClick={onCancel} className="border-white/20 text-white">Annuler</Button>
          <Button type="submit" disabled={submitting} className="bg-[#FF6A00] text-white hover:bg-[#ff8124]">{submitting ? "…" : "Enregistrer"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
