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
import { Plus, Film, ChevronDown, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney } from "@/lib/hexaro";

export const Route = createFileRoute("/_authenticated/netflix")({
  head: () => ({ meta: [{ title: "Netflix — Hexaro" }] }),
  component: NetflixPage,
});

function NetflixPage() {
  const qc = useQueryClient();
  const [openAcc, setOpenAcc] = useState(false);
  const [openProfile, setOpenProfile] = useState<{ accountId: string; profile?: any } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["nf_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("netflix_accounts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["nf_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("netflix_profiles").select("*, clients(first_name, last_name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_light"],
    queryFn: async () => (await supabase.from("clients").select("id, first_name, last_name, pseudo").order("first_name")).data ?? [],
  });

  const createAcc = useMutation({
    mutationFn: async (v: any) => {
      const { error } = await supabase.from("netflix_accounts").insert({
        email: v.email, password: v.password,
        profiles_capacity: parseInt(v.profiles_capacity) || 5,
        expires_on: v.expires_on || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nf_accounts"] }); toast.success("Compte ajouté"); setOpenAcc(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const delAcc = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("netflix_accounts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nf_accounts"] }); qc.invalidateQueries({ queryKey: ["nf_profiles"] }); toast.success("Compte supprimé"); },
    onError: (e: any) => toast.error(e.message),
  });

  const upsertProfile = useMutation({
    mutationFn: async (v: any) => {
      const payload = {
        account_id: v.account_id,
        profile_name: v.profile_name,
        pin: v.pin || null,
        pseudo: v.pseudo || null,
        client_id: v.client_id || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: parseInt(v.duration_days) || 30,
        price: parseFloat(v.price) || 0,
      };
      if (v.id) {
        const { error } = await supabase.from("netflix_profiles").update(payload).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("netflix_profiles").insert(payload);
        if (error) throw error;
        // Log revenue
        if (payload.price > 0) {
          await supabase.from("payments").insert({ service_slug: "netflix", client_id: payload.client_id, amount: payload.price, reference: `Netflix — ${payload.profile_name}` });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nf_profiles"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Profil enregistré"); setOpenProfile(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const delProfile = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("netflix_profiles").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nf_profiles"] }); toast.success("Profil supprimé"); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Netflix"
        description={`${accounts.length} compte(s) · ${profiles.length} profil(s)`}
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
        <EmptyState title="Aucun compte Netflix" description="Ajoutez votre premier compte pour commencer à créer des profils." />
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => {
            const accProfiles = profiles.filter((p) => p.account_id === acc.id);
            return (
              <AccountCard
                key={acc.id}
                acc={acc}
                accProfiles={accProfiles}
                clients={clients}
                onDelete={() => { if (confirm("Supprimer ce compte et tous ses profils ?")) delAcc.mutate(acc.id); }}
                onEditProfile={(p: any) => setOpenProfile({ accountId: acc.id, profile: p })}
                onDeleteProfile={(id: string) => { if (confirm("Supprimer ce profil ?")) delProfile.mutate(id); }}
                onNewProfile={() => setOpenProfile({ accountId: acc.id })}
              />
            );
          })}
        </div>
      )}

      <Dialog open={!!openProfile} onOpenChange={(o) => !o && setOpenProfile(null)}>
        {openProfile && (
          <ProfileForm
            accountId={openProfile.accountId}
            initial={openProfile.profile}
            clients={clients}
            onSubmit={(v: any) => upsertProfile.mutate({ ...v, id: openProfile.profile?.id, account_id: openProfile.accountId })}
            submitting={upsertProfile.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

function AccountCard({ acc, accProfiles, clients, onDelete, onEditProfile, onDeleteProfile, onNewProfile }: any) {
  const [open, setOpen] = useState(true);
  const [showPw, setShowPw] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="hex-glass rounded-2xl overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="h-11 w-11 rounded-xl grid place-items-center bg-[oklch(0.5_0.25_25)]/20 text-[oklch(0.7_0.25_25)]">
          <Film className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{acc.email}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{accProfiles.length}/{acc.profiles_capacity} profils</span>
            <span>·</span>
            <button onClick={() => setShowPw(!showPw)} className="flex items-center gap-1 hover:text-foreground">
              {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPw ? acc.password : "••••••••"}
            </button>
          </div>
        </div>
        <StatusPill tone={acc.status === "active" ? "success" : "muted"}>{acc.status}</StatusPill>
        <Button size="sm" variant="ghost" onClick={onNewProfile} className="gap-1"><Plus className="h-3.5 w-3.5" /> Profil</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        <CollapsibleTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8"><ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accProfiles.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-6">Aucun profil sur ce compte.</p>}
          {accProfiles.map((p: any) => {
            const exp = computeExpiration(p.start_date, p.duration_days);
            const client = p.clients ? `${p.clients.first_name} ${p.clients.last_name ?? ""}`.trim() : "Non attribué";
            return (
              <div key={p.id} className="rounded-xl border border-border bg-background/40 p-4 group">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{p.profile_name}</p>
                    <p className="text-xs text-muted-foreground">{p.pseudo ? `@${p.pseudo}` : ""} · PIN {p.pin ?? "—"}</p>
                  </div>
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <p className="text-sm mt-3">{client}</p>
                <p className="text-xs text-muted-foreground">{formatMoney(p.price)} · {p.duration_days}j</p>
                <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEditProfile(p)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDeleteProfile(p.id)}><Trash2 className="h-3 w-3" /></Button>
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
  const [v, setV] = useState({ email: "", password: "", profiles_capacity: "5", expires_on: "" });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nouveau compte Netflix</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label>Email</Label><Input required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mot de passe</Label><Input required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Nombre de profils</Label><Input type="number" min="1" max="10" value={v.profiles_capacity} onChange={(e) => setV({ ...v, profiles_capacity: e.target.value })} /></div>
          <div className="space-y-2"><Label>Expire le</Label><Input type="date" value={v.expires_on} onChange={(e) => setV({ ...v, expires_on: e.target.value })} /></div>
        </div>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function ProfileForm({ accountId, initial, clients, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    profile_name: initial?.profile_name ?? "",
    pin: initial?.pin ?? "",
    pseudo: initial?.pseudo ?? "",
    client_id: initial?.client_id ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 30),
    price: String(initial?.price ?? 3000),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{initial ? "Modifier le profil" : "Nouveau profil"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="grid grid-cols-2 gap-3">
        <div className="space-y-2 col-span-2"><Label>Nom du profil *</Label><Input required value={v.profile_name} onChange={(e) => setV({ ...v, profile_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>PIN</Label><Input value={v.pin} onChange={(e) => setV({ ...v, pin: e.target.value })} maxLength={6} /></div>
        <div className="space-y-2"><Label>Pseudo</Label><Input value={v.pseudo} onChange={(e) => setV({ ...v, pseudo: e.target.value })} /></div>
        <div className="space-y-2 col-span-2">
          <Label>Client</Label>
          <Select value={v.client_id || "_none"} onValueChange={(x) => setV({ ...v, client_id: x === "_none" ? "" : x })}>
            <SelectTrigger><SelectValue placeholder="Non attribué" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Non attribué</SelectItem>
              {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name ?? ""} {c.pseudo && `(@${c.pseudo})`}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Date début</Label><Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
        <div className="space-y-2"><Label>Durée (jours)</Label><Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} /></div>
        <div className="space-y-2 col-span-2"><Label>Prix (F)</Label><Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></div>
        <DialogFooter className="col-span-2"><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Enregistrer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
