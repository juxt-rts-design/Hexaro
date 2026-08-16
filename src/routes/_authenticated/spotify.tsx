import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney, formatDate, bySoonestExpiry } from "@/lib/hexaro";
import { SpotifyLogo } from "@/components/brand-logos";
import { useConfirm } from "@/components/confirm-provider";
import { recordPayment, syncLatestPaymentAmount, PAYMENT_METHODS } from "@/lib/payments";
import { PaymentFields } from "@/components/payment-fields";
import { AccountPassword } from "@/components/account-password";
import { SpotifyPortrait } from "@/lib/spotify-portrait";
import { cn } from "@/lib/utils";
import { PageClientFilter, useClientSearch } from "@/components/client-search";
import { clientMatches, searchHaystack } from "@/lib/client-search";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/spotify")({
  head: () => ({ meta: [{ title: "Spotify — Hexaro" }] }),
  component: SpotifyPage,
});

const DURATIONS = [
  { days: 30, label: "1 mois" },
  { days: 60, label: "2 mois" },
  { days: 90, label: "3 mois" },
  { days: 180, label: "6 mois" },
  { days: 365, label: "12 mois" },
];

function durationLabel(days: number) {
  const found = DURATIONS.find((d) => d.days === days);
  if (found) return found.label;
  if (days % 30 === 0) return `${days / 30} mois`;
  return `${days} j`;
}

function SpotifyPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const { isAdmin } = useAuth();
  const [openAcc, setOpenAcc] = useState(false);
  const [openMember, setOpenMember] = useState<{ accountId: string; member?: any } | null>(null);
  const [view, setView] = useState<{ account: any; member: any } | null>(null);
  const { query, openTarget, setOpenTarget } = useClientSearch();

  const { data: accounts = [], isPending: accountsPending } = useQuery({
    queryKey: ["sp_accounts"],
    queryFn: async () => (await supabase.from("spotify_accounts").select("id, email, seats, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: members = [], isPending: membersPending } = useQuery({
    queryKey: ["sp_members"],
    queryFn: async () => (await supabase.from("spotify_members").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const createAcc = useMutation({
    mutationFn: async (v: any) => {
      const { error } = await supabase.from("spotify_accounts").insert({
        email: v.email, password: v.password,
        seats: parseInt(v.seats) || 6,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      void logActivity({ action: "spotify_accounts.insert", entity_type: "spotify_accounts", metadata: { label: v.email } });
      qc.invalidateQueries({ queryKey: ["sp_accounts"] }); toast.success("Compte ajouté"); setOpenAcc(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delAcc = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("spotify_accounts").delete().eq("id", id); if (error) throw error; },
    onSuccess: (_d, id) => {
      void logActivity({ action: "spotify_accounts.delete", entity_type: "spotify_accounts", entity_id: id });
      qc.invalidateQueries({ queryKey: ["sp_accounts"] }); qc.invalidateQueries({ queryKey: ["sp_members"] }); toast.success("Compte supprimé");
    },
  });

  const upsertMember = useMutation({
    mutationFn: async (v: any) => {
      const payload = {
        account_id: v.account_id,
        member_name: v.member_name,
        pseudo: v.pseudo || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: parseInt(v.duration_days) || 30,
        price: parseFloat(v.price) || 0,
      };
      if (v.id) {
        const { error } = await supabase.from("spotify_members").update(payload).eq("id", v.id);
        if (error) throw error;
        if (v.record_payment && payload.price > 0) {
          await recordPayment({
            service_slug: "spotify", amount: payload.price, method: v.method, kind: "renouvellement",
            subscription_id: v.id, subscription_type: "spotify_members", client_name: payload.member_name,
            reference: `Renouvellement Spotify — ${payload.member_name}`,
          });
        } else {
          await syncLatestPaymentAmount({
            service_slug: "spotify",
            amount: payload.price,
            method: v.method,
            subscription_id: v.id,
            subscription_type: "spotify_members",
            client_name: payload.member_name,
            reference: `Spotify — ${payload.member_name}`,
          });
        }
      } else {
        const { data, error } = await supabase.from("spotify_members").insert(payload).select("id").single();
        if (error) throw error;
        if (payload.price > 0) {
          await recordPayment({
            service_slug: "spotify", amount: payload.price, method: v.method, kind: "nouveau",
            subscription_id: data.id, subscription_type: "spotify_members", client_name: payload.member_name,
            reference: `Spotify — ${payload.member_name}`,
          });
        }
      }
    },
    onSuccess: (_d, v) => {
      void logActivity({
        action: v.id ? "spotify_members.update" : "spotify_members.insert",
        entity_type: "spotify_members",
        entity_id: v.id,
        metadata: { label: v.member_name },
      });
      qc.invalidateQueries({ queryKey: ["sp_members"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Membre enregistré — solde mis à jour");
      setOpenMember(null);
      setView(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMember = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("spotify_members").delete().eq("id", id); if (error) throw error; },
    onSuccess: (_d, id) => {
      void logActivity({ action: "spotify_members.delete", entity_type: "spotify_members", entity_id: id });
      qc.invalidateQueries({ queryKey: ["sp_members"] }); toast.success("Membre supprimé"); setView(null);
    },
  });

  const visibleMembers = useMemo(
    () => members.filter((m) => clientMatches(searchHaystack(m.member_name, m.pseudo), query)).sort(bySoonestExpiry),
    [members, query],
  );

  useEffect(() => {
    if (!openTarget || openTarget.slug !== "spotify") return;
    const member = members.find((m) => m.id === openTarget.id);
    const account = accounts.find((a) => a.id === member?.account_id);
    if (member && account) {
      setView({ account, member });
      setOpenTarget(null);
    }
  }, [openTarget, members, accounts, setOpenTarget]);

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-[#1DB954]/25 bg-gradient-to-br from-[#121212] via-[#191414] to-[#0b0b0b] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-8 -top-10 h-48 w-48 rounded-full bg-[#1DB954]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <SpotifyLogo className="h-10 w-auto text-white" />
            <p className="mt-3 text-sm text-white/60">{accounts.length} compte(s) · {members.length} membre(s) Family</p>
          </div>
          <Dialog open={openAcc} onOpenChange={setOpenAcc}>
            <DialogTrigger asChild>
              <Button className="bg-[#1DB954] text-black hover:bg-[#1ed760] font-bold gap-2">
                <Plus className="h-4 w-4" /> Nouveau compte
              </Button>
            </DialogTrigger>
            <AccountForm onSubmit={(v: any) => createAcc.mutate(v)} submitting={createAcc.isPending} />
          </Dialog>
        </div>
      </div>

      <PageClientFilter
        placeholder="Rechercher un membre Spotify (nom ou pseudo)…"
        className="border-white/15 bg-[#121212] text-white placeholder:text-white/40 focus:border-[#1DB954]"
      />

      {accountsPending || membersPending ? null : accounts.length === 0 ? (
        <EmptyState title="Aucun compte Spotify" description="Ajoutez votre premier compte Family pour commencer." />
      ) : (
        <div className="space-y-10">
          {[...accounts].sort((a, b) => {
            const soonest = (id: string) => {
              const list = members.filter((m) => m.account_id === id);
              if (list.length === 0) return Number.POSITIVE_INFINITY;
              return Math.min(...list.map((m) => computeExpiration(m.start_date, m.duration_days).msRemaining));
            };
            return soonest(a.id) - soonest(b.id);
          }).map((acc) => {
            const list = (query.trim() && clientMatches(acc.email, query)
              ? members.filter((m) => m.account_id === acc.id)
              : visibleMembers.filter((m) => m.account_id === acc.id)
            ).sort(bySoonestExpiry);
            if (query.trim() && list.length === 0) return null;
            const seats = acc.seats || 6;
            return (
              <section key={acc.id} className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full grid place-items-center bg-[#1DB954]">
                    <SpotifyLogo className="h-5 w-auto" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{acc.email}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{list.length}/{seats} membres</span>
                      <span>·</span>
                      <AccountPassword service="spotify" accountId={acc.id} />
                    </div>
                  </div>
                  {isAdmin && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={async () => {
                    if (await confirmAction({ title: "Supprimer ce compte ?", description: `${acc.email} et ses ${list.length} membre(s) seront définitivement supprimés.`, destructive: true, confirmLabel: "Supprimer" })) delAcc.mutate(acc.id);
                  }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
                  {list.map((m: any) => {
                    const exp = computeExpiration(m.start_date, m.duration_days);
                    const active = exp.status !== "expired";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setView({ account: acc, member: m })}
                        className="group flex flex-col items-center gap-3 rounded-2xl p-3 hover:bg-white/5 transition"
                      >
                        <SpotifyPortrait name={m.member_name} active={active} className="h-24 w-24" />
                        <div className="text-center">
                          <p className="font-semibold leading-tight">{m.member_name}</p>
                          <p className={cn("text-xs mt-0.5", active ? "text-[#1DB954]" : "text-destructive")}>
                            {active ? exp.label : "Expiré"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                  {list.length < seats && (
                    <button
                      type="button"
                      onClick={() => setOpenMember({ accountId: acc.id })}
                      className="flex flex-col items-center gap-3 rounded-2xl p-3 hover:bg-white/5 transition"
                    >
                      <div className="h-24 w-24 rounded-full grid place-items-center border-2 border-dashed border-[#1DB954]/50 text-[#1DB954]">
                        <Plus className="h-8 w-8" />
                      </div>
                      <p className="text-sm text-muted-foreground">Ajouter</p>
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view && (
          <MemberIdentity
            account={view.account}
            member={view.member}
            onEdit={() => { setOpenMember({ accountId: view.account.id, member: view.member }); setView(null); }}
            onDelete={async () => {
              if (await confirmAction({ title: "Supprimer ce membre ?", description: `« ${view.member.member_name} » sera définitivement supprimé.`, destructive: true, confirmLabel: "Supprimer" })) {
                delMember.mutate(view.member.id);
              }
            }}
          />
        )}
      </Dialog>

      <Dialog open={!!openMember} onOpenChange={(o) => !o && setOpenMember(null)}>
        {openMember && (
          <MemberForm
            initial={openMember.member}
            onSubmit={(v: any) => upsertMember.mutate({ ...v, id: openMember.member?.id, account_id: openMember.accountId })}
            submitting={upsertMember.isPending}
            onCancel={() => setOpenMember(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function MemberIdentity({ account, member, onEdit, onDelete }: any) {
  const exp = computeExpiration(member.start_date, member.duration_days);
  const fin = new Date(new Date(member.start_date).getTime() + member.duration_days * 24 * 60 * 60 * 1000);
  const active = exp.status !== "expired";
  return (
    <DialogContent className="max-w-lg border-[#1DB954]/20 bg-[#121212] text-white">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-white">
          <SpotifyPortrait name={member.member_name} active={active} className="h-12 w-12" />
          {member.member_name}
        </DialogTitle>
      </DialogHeader>
      <table className="w-full text-sm">
        <tbody>
          <IdRow label="Membre" value={member.member_name} />
          <IdRow label="Pseudo" value={member.pseudo || "—"} />
          <IdRow label="Début" value={formatDate(member.start_date)} />
          <IdRow label="Durée" value={durationLabel(member.duration_days)} />
          <IdRow label="Fin" value={formatDate(fin.toISOString())} />
          <tr className="border-b border-white/10">
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-white/50 w-[42%]">Statut</td>
            <td className={cn("py-2.5 font-medium", active ? "text-[#1DB954]" : "text-[#fb7185]")}>{active ? exp.label : "Expiré"}</td>
          </tr>
          <IdRow label="Montant" value={formatMoney(member.price)} />
          <tr>
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-white/50">Mot de passe</td>
            <td className="py-2.5"><AccountPassword service="spotify" accountId={account.id} /></td>
          </tr>
        </tbody>
      </table>
      <DialogFooter className="bg-[#121212] sm:justify-between">
        <Button type="button" variant="ghost" className="text-[#fb7185]" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-1" /> Supprimer
        </Button>
        <Button type="button" onClick={onEdit} className="bg-[#1DB954] text-black hover:bg-[#1ed760] font-bold gap-1">
          <Pencil className="h-4 w-4" /> Modifier
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-white/10">
      <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-white/50 w-[42%]">{label}</td>
      <td className="py-2.5 font-medium">{value}</td>
    </tr>
  );
}

function AccountForm({ onSubmit, submitting }: any) {
  const [v, setV] = useState({ email: "", password: "", seats: "6" });
  return (
    <DialogContent className="border-[#1DB954]/20 bg-[#121212] text-white">
      <DialogHeader><DialogTitle className="text-white">Nouveau compte Spotify</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label className="text-white/60">Email</Label><Input required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className="bg-[#191414] border-white/15 text-white" /></div>
        <div className="space-y-2"><Label className="text-white/60">Mot de passe</Label><Input required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} className="bg-[#191414] border-white/15 text-white" /></div>
        <div className="space-y-2"><Label className="text-white/60">Membres max</Label><Input type="number" min="1" max="10" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} className="bg-[#191414] border-white/15 text-white" /></div>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-[#1DB954] text-black hover:bg-[#1ed760] font-bold">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function MemberForm({ initial, onSubmit, submitting, onCancel }: any) {
  const [v, setV] = useState({
    member_name: initial?.member_name ?? "",
    pseudo: initial?.pseudo ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 2000),
    method: PAYMENT_METHODS[0]!.value as string,
    record_payment: false,
  });
  return (
    <DialogContent className="border-[#1DB954]/20 bg-[#121212] text-white">
      <DialogHeader>
        <DialogTitle className="uppercase tracking-wide text-white">{initial ? "Modifier le membre" : "Nouveau membre"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex items-center gap-3">
          <SpotifyPortrait name={v.member_name || "?"} className="h-14 w-14" />
          <p className="text-sm text-white/50">Profil vivant — unique à chaque membre</p>
        </div>
        <div className="space-y-2 col-span-2">
          <Label className="text-white/60">Nom du client *</Label>
          <Input required value={v.member_name} onChange={(e) => setV({ ...v, member_name: e.target.value })} className="bg-[#191414] border-white/15 text-white" />
        </div>
        <div className="space-y-2 col-span-2">
          <Label className="text-white/60">Pseudo / Téléphone</Label>
          <Input value={v.pseudo} onChange={(e) => setV({ ...v, pseudo: e.target.value })} className="bg-[#191414] border-white/15 text-white" />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60">Date début</Label>
          <Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} className="bg-[#191414] border-white/15 text-white" />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60">Durée (jours)</Label>
          <Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} className="bg-[#191414] border-white/15 text-white" />
        </div>
        <div className="space-y-2 col-span-2">
          <Label className="text-white/60">Prix (F)</Label>
          <Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className="bg-[#191414] border-white/15 text-white" />
        </div>
        <PaymentFields isEdit={!!initial} method={v.method} onMethod={(m: string) => setV({ ...v, method: m })} recordPayment={v.record_payment} onRecordPayment={(b: boolean) => setV({ ...v, record_payment: b })} />
        <DialogFooter className="col-span-2 bg-[#121212] sm:justify-between">
          <Button type="button" variant="outline" onClick={onCancel} className="border-white/20 text-white">Annuler</Button>
          <Button type="submit" disabled={submitting} className="bg-[#1DB954] text-black hover:bg-[#1ed760] font-bold">{submitting ? "…" : "Enregistrer"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
