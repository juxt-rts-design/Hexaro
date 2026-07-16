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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Music2, ChevronDown, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney } from "@/lib/hexaro";

export const Route = createFileRoute("/_authenticated/spotify")({
  head: () => ({ meta: [{ title: "Spotify — Hexaro" }] }),
  component: SpotifyPage,
});

function SpotifyPage() {
  const qc = useQueryClient();
  const [openAcc, setOpenAcc] = useState(false);
  const [openMember, setOpenMember] = useState<{ accountId: string; member?: any } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["sp_accounts"],
    queryFn: async () => (await supabase.from("spotify_accounts").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: members = [] } = useQuery({
    queryKey: ["sp_members"],
    queryFn: async () => (await supabase.from("spotify_members").select("*, clients(first_name, last_name)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_light"],
    queryFn: async () => (await supabase.from("clients").select("id, first_name, last_name, pseudo").order("first_name")).data ?? [],
  });

  const createAcc = useMutation({
    mutationFn: async (v: any) => {
      const { error } = await supabase.from("spotify_accounts").insert({ email: v.email, password: v.password, seats: parseInt(v.seats) || 6 });
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
        member_email: v.member_email || null,
        client_id: v.client_id || null,
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
        if (payload.price > 0) await supabase.from("payments").insert({ service_slug: "spotify", client_id: payload.client_id, amount: payload.price, reference: `Spotify — ${payload.member_name}` });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_members"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Enregistré"); setOpenMember(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMember = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("spotify_members").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sp_members"] }); toast.success("Supprimé"); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spotify"
        description={`${accounts.length} Family · ${members.length} membre(s)`}
        actions={
          <Dialog open={openAcc} onOpenChange={setOpenAcc}>
            <DialogTrigger asChild><Button className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Nouveau compte Family</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nouveau compte Spotify Family</DialogTitle></DialogHeader>
              <AccountForm onSubmit={(v: any) => createAcc.mutate(v)} submitting={createAcc.isPending} />
            </DialogContent>
          </Dialog>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState title="Aucun compte Spotify" description="Ajoutez un compte Family pour commencer." />
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => {
            const accMembers = members.filter((m) => m.account_id === acc.id);
            const remaining = acc.seats - accMembers.length;
            return (
              <AccountCard key={acc.id} acc={acc} members={accMembers} remaining={remaining}
                onDelete={() => { if (confirm("Supprimer ce compte et ses membres ?")) delAcc.mutate(acc.id); }}
                onNewMember={() => setOpenMember({ accountId: acc.id })}
                onEditMember={(m) => setOpenMember({ accountId: acc.id, member: m })}
                onDeleteMember={(id) => { if (confirm("Retirer ce membre ?")) delMember.mutate(id); }}
              />
            );
          })}
        </div>
      )}

      <Dialog open={!!openMember} onOpenChange={(o) => !o && setOpenMember(null)}>
        {openMember && (
          <DialogContent>
            <DialogHeader><DialogTitle>{openMember.member ? "Modifier le membre" : "Ajouter un membre"}</DialogTitle></DialogHeader>
            <MemberForm initial={openMember.member} clients={clients}
              onSubmit={(v: any) => upsertMember.mutate({ ...v, id: openMember.member?.id, account_id: openMember.accountId })}
              submitting={upsertMember.isPending}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function AccountCard({ acc, members, remaining, onDelete, onNewMember, onEditMember, onDeleteMember }: any) {
  const [open, setOpen] = useState(true);
  const [showPw, setShowPw] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="hex-glass rounded-2xl overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="h-11 w-11 rounded-xl grid place-items-center bg-success/20 text-success"><Music2 className="h-5 w-5" /></div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{acc.email}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{members.length}/{acc.seats} places · {remaining} restante(s)</span>
            <span>·</span>
            <button onClick={() => setShowPw(!showPw)} className="flex items-center gap-1 hover:text-foreground">
              {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{showPw ? acc.password : "••••••••"}
            </button>
          </div>
        </div>
        <Button size="sm" variant="ghost" disabled={remaining <= 0} onClick={onNewMember} className="gap-1"><Plus className="h-3.5 w-3.5" /> Membre</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        <CollapsibleTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-6">Aucun membre.</p>}
          {members.map((m: any) => {
            const exp = computeExpiration(m.start_date, m.duration_days);
            const client = m.clients ? `${m.clients.first_name} ${m.clients.last_name ?? ""}`.trim() : "—";
            return (
              <div key={m.id} className="rounded-xl border border-border bg-background/40 p-4 group">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{m.member_name}</p>
                    <p className="text-xs text-muted-foreground">{m.pseudo && `@${m.pseudo}`} {m.member_email && `· ${m.member_email}`}</p>
                  </div>
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <p className="text-sm mt-3">{client}</p>
                <p className="text-xs text-muted-foreground">{formatMoney(m.price)} · {m.duration_days}j</p>
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
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
      <div className="space-y-2"><Label>Email</Label><Input required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
      <div className="space-y-2"><Label>Mot de passe</Label><Input required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
      <div className="space-y-2"><Label>Nombre de places</Label><Input type="number" min="1" max="10" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} /></div>
      <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
    </form>
  );
}

function MemberForm({ initial, clients, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    member_name: initial?.member_name ?? "",
    pseudo: initial?.pseudo ?? "",
    member_email: initial?.member_email ?? "",
    client_id: initial?.client_id ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 2000),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
      <div className="space-y-2 col-span-2"><Label>Nom *</Label><Input required value={v.member_name} onChange={(e) => setV({ ...v, member_name: e.target.value })} /></div>
      <div className="space-y-2"><Label>Pseudo</Label><Input value={v.pseudo} onChange={(e) => setV({ ...v, pseudo: e.target.value })} /></div>
      <div className="space-y-2"><Label>Email</Label><Input type="email" value={v.member_email} onChange={(e) => setV({ ...v, member_email: e.target.value })} /></div>
      <div className="space-y-2 col-span-2">
        <Label>Client</Label>
        <Select value={v.client_id || "_none"} onValueChange={(x) => setV({ ...v, client_id: x === "_none" ? "" : x })}>
          <SelectTrigger><SelectValue placeholder="Non attribué" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Non attribué</SelectItem>
            {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name ?? ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label>Date début</Label><Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
      <div className="space-y-2"><Label>Durée (j)</Label><Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} /></div>
      <div className="space-y-2 col-span-2"><Label>Prix (F)</Label><Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></div>
      <DialogFooter className="col-span-2"><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Enregistrer"}</Button></DialogFooter>
    </form>
  );
}
