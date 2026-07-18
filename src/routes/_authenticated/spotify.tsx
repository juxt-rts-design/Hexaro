import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, ChevronDown, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney } from "@/lib/hexaro";
import { SpotifyLogo } from "@/components/brand-logos";
import { useConfirm } from "@/components/confirm-provider";

export const Route = createFileRoute("/_authenticated/spotify")({
  head: () => ({ meta: [{ title: "Spotify — Hexaro" }] }),
  component: SpotifyPage,
});

function SpotifyPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const [openAcc, setOpenAcc] = useState(false);
  const [openMember, setOpenMember] = useState<{ accountId: string; member?: any } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["sp_accounts"],
    queryFn: async () => (await supabase.from("spotify_accounts").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: members = [] } = useQuery({
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_accounts"] }); toast.success("Compte ajouté"); setOpenAcc(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const delAcc = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("spotify_accounts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_accounts"] }); qc.invalidateQueries({ queryKey: ["sp_members"] }); toast.success("Compte supprimé"); },
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
      } else {
        const { error } = await supabase.from("spotify_members").insert(payload);
        if (error) throw error;
        if (payload.price > 0) {
          await supabase.from("payments").insert({ service_slug: "spotify", amount: payload.price, reference: `Spotify — ${payload.member_name}` });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_members"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Membre enregistré"); setOpenMember(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const delMember = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("spotify_members").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_members"] }); toast.success("Membre supprimé"); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3"><SpotifyLogo className="h-6 w-auto text-foreground" /> <span>Spotify</span></span>}
        description={`${accounts.length} compte(s) · ${members.length} membre(s)`}
        actions={
          <Dialog open={openAcc} onOpenChange={setOpenAcc}>
            <DialogTrigger asChild>
              <Button className="bg-brand text-brand-foreground hover:opacity-90 gap-2"><Plus className="h-4 w-4" /> Nouveau compte</Button>
            </DialogTrigger>
            <AccountForm onSubmit={(v: any) => createAcc.mutate(v)} submitting={createAcc.isPending} />
          </Dialog>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState title="Aucun compte Spotify" description="Ajoutez votre premier compte Family pour commencer." />
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => {
            const list = members.filter((m) => m.account_id === acc.id);
            return (
              <AccountCard
                key={acc.id}
                acc={acc}
                list={list}
                onDelete={() => { if (confirm("Supprimer ce compte et tous ses membres ?")) delAcc.mutate(acc.id); }}
                onEditMember={(m: any) => setOpenMember({ accountId: acc.id, member: m })}
                onDeleteMember={(id: string) => { if (confirm("Supprimer ce membre ?")) delMember.mutate(id); }}
                onNewMember={() => setOpenMember({ accountId: acc.id })}
              />
            );
          })}
        </div>
      )}

      <Dialog open={!!openMember} onOpenChange={(o) => !o && setOpenMember(null)}>
        {openMember && (
          <MemberForm
            initial={openMember.member}
            onSubmit={(v: any) => upsertMember.mutate({ ...v, id: openMember.member?.id, account_id: openMember.accountId })}
            submitting={upsertMember.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

function AccountCard({ acc, list, onDelete, onEditMember, onDeleteMember, onNewMember }: any) {
  const [open, setOpen] = useState(true);
  const [showPw, setShowPw] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="hex-glass rounded-2xl overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="h-11 w-11 rounded-xl grid place-items-center bg-[#1DB954]/15">
          <SpotifyLogo className="h-4 w-auto text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{acc.email}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{list.length}/{acc.seats} membres</span>
            <span>·</span>
            <button onClick={() => setShowPw(!showPw)} className="flex items-center gap-1 hover:text-foreground">
              {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPw ? acc.password : "••••••••"}
            </button>
          </div>
        </div>
        <StatusPill tone={acc.status === "active" ? "success" : "muted"}>{acc.status}</StatusPill>
        <Button size="sm" variant="ghost" onClick={onNewMember} className="gap-1"><Plus className="h-3.5 w-3.5" /> Membre</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        <CollapsibleTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8"><ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-6">Aucun membre.</p>}
          {list.map((m: any) => {
            const exp = computeExpiration(m.start_date, m.duration_days);
            return (
              <div key={m.id} className="rounded-xl border border-border bg-background/40 p-4 group">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{m.member_name}</p>
                    <p className="text-xs text-muted-foreground">{m.pseudo ? `@${m.pseudo}` : "—"}</p>
                  </div>
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground mt-3">{formatMoney(m.price)} · {m.duration_days}j</p>
                <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEditMember(m)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDeleteMember(m.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AccountForm({ onSubmit, submitting }: any) {
  const [v, setV] = useState({ email: "", password: "", seats: "6" });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nouveau compte Spotify</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label>Email</Label><Input required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mot de passe</Label><Input required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <div className="space-y-2"><Label>Membres max</Label><Input type="number" min="1" max="10" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} /></div>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function MemberForm({ initial, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    member_name: initial?.member_name ?? "",
    pseudo: initial?.pseudo ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 2000),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{initial ? "Modifier le membre" : "Nouveau membre"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
        <div className="space-y-2 col-span-2"><Label>Nom du client *</Label><Input required value={v.member_name} onChange={(e) => setV({ ...v, member_name: e.target.value })} /></div>
        <div className="space-y-2 col-span-2"><Label>Pseudo / Téléphone</Label><Input value={v.pseudo} onChange={(e) => setV({ ...v, pseudo: e.target.value })} /></div>
        <div className="space-y-2"><Label>Date début</Label><Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
        <div className="space-y-2"><Label>Durée (jours)</Label><Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} /></div>
        <div className="space-y-2 col-span-2"><Label>Prix (F)</Label><Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></div>
        <DialogFooter className="col-span-2"><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Enregistrer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
