import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney, formatDate, bySoonestExpiry } from "@/lib/hexaro";
import { NetflixLogo } from "@/components/brand-logos";
import { useConfirm } from "@/components/confirm-provider";
import { recordPayment, syncLatestPaymentAmount, PAYMENT_METHODS } from "@/lib/payments";
import { PaymentFields } from "@/components/payment-fields";
import { AccountPassword } from "@/components/account-password";
import { cn } from "@/lib/utils";
import { ProfileAvatar, AvatarGrid } from "@/lib/netflix-avatars";
import { PageClientFilter, useClientSearch } from "@/components/client-search";
import { clientMatches, searchHaystack } from "@/lib/client-search";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/netflix")({
  head: () => ({ meta: [{ title: "Netflix — Hexaro" }] }),
  component: NetflixPage,
});

const DURATIONS = [
  { days: 31, label: "1 mois" },
  { days: 62, label: "2 mois" },
  { days: 93, label: "3 mois" },
  { days: 186, label: "6 mois" },
  { days: 365, label: "12 mois" },
];

function durationLabel(days: number) {
  const found = DURATIONS.find((d) => d.days === days);
  if (found) return found.label;
  if (days % 30 === 0) return `${days / 30} mois`;
  return `${days} j`;
}

function NetflixPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const { isAdmin } = useAuth();
  const [openAcc, setOpenAcc] = useState(false);
  const [openProfile, setOpenProfile] = useState<{ accountId: string; profile?: any; avatar?: string } | null>(null);
  const [viewProfile, setViewProfile] = useState<{ account: any; profile: any; slot: number } | null>(null);
  const [iconPick, setIconPick] = useState<{ accountId: string; profile?: any; forName?: string } | null>(null);
  const { query, openTarget, setOpenTarget } = useClientSearch();

  const { data: accounts = [], isPending: accountsPending } = useQuery({
    queryKey: ["nf_accounts"],
    queryFn: async () => (await supabase.from("netflix_accounts").select("id, email, profiles_capacity, created_on, expires_on, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: profiles = [], isPending: profilesPending } = useQuery({
    queryKey: ["nf_profiles"],
    queryFn: async () => (await supabase.from("netflix_profiles").select("*").order("created_at", { ascending: false })).data ?? [],
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
    onSuccess: (_d, v) => {
      void logActivity({ action: "netflix_accounts.insert", entity_type: "netflix_accounts", metadata: { label: v.email } });
      qc.invalidateQueries({ queryKey: ["nf_accounts"] }); toast.success("Compte ajouté"); setOpenAcc(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delAcc = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("netflix_accounts").delete().eq("id", id); if (error) throw error; },
    onSuccess: (_d, id) => {
      void logActivity({ action: "netflix_accounts.delete", entity_type: "netflix_accounts", entity_id: id });
      qc.invalidateQueries({ queryKey: ["nf_accounts"] }); qc.invalidateQueries({ queryKey: ["nf_profiles"] }); toast.success("Compte supprimé");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateAvatar = useMutation({
    mutationFn: async (vars: { id: string; avatar: string }) => {
      const { error } = await supabase.from("netflix_profiles").update({ avatar: vars.avatar }).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nf_profiles"] }); toast.success("Icône enregistrée"); },
    onError: (e: any) => toast.error(e.message),
  });

  const upsertProfile = useMutation({
    mutationFn: async (v: any) => {
      const payload = {
        account_id: v.account_id,
        profile_name: v.profile_name,
        pin: v.pin || null,
        pseudo: v.pseudo || null,
        avatar: v.avatar || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: parseInt(v.duration_days) || 31,
        price: parseFloat(v.price) || 0,
      };
      if (v.id) {
        let { error } = await supabase.from("netflix_profiles").update(payload).eq("id", v.id);
        if (error && /avatar/i.test(error.message)) {
          const { avatar: _a, ...rest } = payload;
          const retry = await supabase.from("netflix_profiles").update(rest).eq("id", v.id);
          error = retry.error;
        }
        if (error) throw error;
        if (v.record_payment && payload.price > 0) {
          await recordPayment({
            service_slug: "netflix", amount: payload.price, method: v.method, kind: "renouvellement",
            subscription_id: v.id, subscription_type: "netflix_profiles", client_name: payload.profile_name,
            reference: `Renouvellement Netflix — ${payload.profile_name}`,
          });
        } else {
          await syncLatestPaymentAmount({
            service_slug: "netflix",
            amount: payload.price,
            method: v.method,
            subscription_id: v.id,
            subscription_type: "netflix_profiles",
            client_name: payload.profile_name,
            reference: `Netflix — ${payload.profile_name}`,
          });
        }
      } else {
        let { data, error } = await supabase.from("netflix_profiles").insert(payload).select("id").single();
        if (error && /avatar/i.test(error.message)) {
          const { avatar: _a, ...rest } = payload;
          const retry = await supabase.from("netflix_profiles").insert(rest).select("id").single();
          data = retry.data;
          error = retry.error;
        }
        if (error) throw error;
        if (payload.price > 0) {
          await recordPayment({
            service_slug: "netflix", amount: payload.price, method: v.method, kind: "nouveau",
            subscription_id: data.id, subscription_type: "netflix_profiles", client_name: payload.profile_name,
            reference: `Netflix — ${payload.profile_name}`,
          });
        }
      }
    },
    onSuccess: (_d, v) => {
      void logActivity({
        action: v.id ? "netflix_profiles.update" : "netflix_profiles.insert",
        entity_type: "netflix_profiles",
        entity_id: v.id,
        metadata: { label: v.profile_name },
      });
      qc.invalidateQueries({ queryKey: ["nf_profiles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Profil enregistré — solde mis à jour");
      setOpenProfile(null);
      setViewProfile(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delProfile = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("netflix_profiles").delete().eq("id", id); if (error) throw error; },
    onSuccess: (_d, id) => {
      void logActivity({ action: "netflix_profiles.delete", entity_type: "netflix_profiles", entity_id: id });
      qc.invalidateQueries({ queryKey: ["nf_profiles"] }); toast.success("Profil supprimé"); setViewProfile(null);
    },
  });

  const visibleProfiles = useMemo(
    () => profiles.filter((p) => clientMatches(searchHaystack(p.profile_name, p.pseudo), query)).sort(bySoonestExpiry),
    [profiles, query],
  );

  useEffect(() => {
    if (!openTarget || openTarget.slug !== "netflix") return;
    const profile = profiles.find((p) => p.id === openTarget.id);
    const account = accounts.find((a) => a.id === profile?.account_id);
    if (profile && account) {
      const slot = profiles.filter((p) => p.account_id === account.id).findIndex((p) => p.id === profile.id) + 1;
      setViewProfile({ account, profile, slot });
      setOpenTarget(null);
    }
  }, [openTarget, profiles, accounts, setOpenTarget]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<NetflixLogo className="h-9 w-auto" /> as any}
        description={`${accounts.length} compte(s) · ${profiles.length} profil(s)`}
        actions={
          <Dialog open={openAcc} onOpenChange={setOpenAcc}>
            <DialogTrigger asChild>
              <Button className="bg-[#E50914] text-white hover:bg-[#E50914]/90 gap-2"><Plus className="h-4 w-4" /> Nouveau compte</Button>
            </DialogTrigger>
            <AccountForm onSubmit={(v: any) => createAcc.mutate(v)} submitting={createAcc.isPending} />
          </Dialog>
        }
      />

      <PageClientFilter placeholder="Rechercher un profil Netflix (nom ou pseudo)…" />

      {accountsPending || profilesPending ? null : accounts.length === 0 ? (
        <EmptyState title="Aucun compte Netflix" description="Ajoutez votre premier compte pour commencer à créer des profils." />
      ) : (
        <div className="space-y-8">
          {[...accounts].sort((a, b) => {
            const soonest = (id: string) => {
              const list = profiles.filter((p) => p.account_id === id);
              if (list.length === 0) return Number.POSITIVE_INFINITY;
              return Math.min(...list.map((p) => computeExpiration(p.start_date, p.duration_days).msRemaining));
            };
            return soonest(a.id) - soonest(b.id);
          }).map((acc) => {
            const accProfiles = (query.trim() && clientMatches(acc.email, query)
              ? profiles.filter((p) => p.account_id === acc.id)
              : visibleProfiles.filter((p) => p.account_id === acc.id)
            ).sort(bySoonestExpiry);
            if (query.trim() && accProfiles.length === 0) return null;
            return (
              <AccountProfiles
                key={acc.id}
                acc={acc}
                accProfiles={accProfiles}
                onDelete={isAdmin ? async () => {
                  if (await confirmAction({ title: "Supprimer ce compte ?", description: `Le compte ${acc.email} et ses ${accProfiles.length} profil(s) seront définitivement supprimés.`, destructive: true, confirmLabel: "Supprimer" })) delAcc.mutate(acc.id);
                } : undefined}
                onView={(p: any, slot: number) => setViewProfile({ account: acc, profile: p, slot })}
                onNewProfile={() => setIconPick({ accountId: acc.id, forName: "nouveau profil" })}
              />
            );
          })}
        </div>
      )}

      <Dialog open={!!viewProfile} onOpenChange={(o) => !o && setViewProfile(null)}>
        {viewProfile && (
          <ProfileIdentity
            account={viewProfile.account}
            profile={viewProfile.profile}
            slot={viewProfile.slot}
            onEdit={() => {
              setOpenProfile({ accountId: viewProfile.account.id, profile: viewProfile.profile, avatar: viewProfile.profile.avatar });
              setViewProfile(null);
            }}
            onChangeIcon={() => {
              setIconPick({ accountId: viewProfile.account.id, profile: viewProfile.profile, forName: viewProfile.profile.profile_name });
            }}
            onDelete={async () => {
              if (await confirmAction({ title: "Supprimer ce profil ?", description: `Le profil « ${viewProfile.profile.profile_name} » sera définitivement supprimé.`, destructive: true, confirmLabel: "Supprimer" })) {
                delProfile.mutate(viewProfile.profile.id);
              }
            }}
          />
        )}
      </Dialog>

      <Dialog open={!!openProfile} onOpenChange={(o) => !o && setOpenProfile(null)}>
        {openProfile && (
          <ProfileForm
            initial={openProfile.profile}
            avatar={openProfile.avatar ?? openProfile.profile?.avatar}
            onPickIcon={() => {
              setIconPick({
                accountId: openProfile.accountId,
                profile: openProfile.profile,
                forName: openProfile.profile?.profile_name || "nouveau profil",
              });
            }}
            onSubmit={(v: any) => upsertProfile.mutate({ ...v, id: openProfile.profile?.id, account_id: openProfile.accountId, avatar: v.avatar ?? openProfile.avatar })}
            submitting={upsertProfile.isPending}
            onCancel={() => setOpenProfile(null)}
          />
        )}
      </Dialog>

      <Dialog open={!!iconPick} onOpenChange={(o) => !o && setIconPick(null)}>
        {iconPick && (
          <IconPicker
            forName={iconPick.forName || "nouveau profil"}
            selected={iconPick.profile?.avatar ?? openProfile?.avatar}
            onPick={(id) => {
              if (iconPick.profile?.id) {
                updateAvatar.mutate({ id: iconPick.profile.id, avatar: id });
                setViewProfile((cur) =>
                  cur && cur.profile.id === iconPick.profile.id
                    ? { ...cur, profile: { ...cur.profile, avatar: id } }
                    : cur,
                );
              } else if (openProfile) {
                setOpenProfile({ ...openProfile, avatar: id });
              } else {
                setOpenProfile({ accountId: iconPick.accountId, avatar: id });
              }
              setIconPick(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function AccountProfiles({ acc, accProfiles, onDelete, onView, onNewProfile }: any) {
  const capacity = acc.profiles_capacity || 5;
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-8 rounded-md bg-black px-2 grid place-items-center shrink-0">
          <NetflixLogo className="h-5 w-auto" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{acc.email}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{accProfiles.length}/{capacity} profils</span>
            <span>·</span>
            <AccountPassword service="netflix" accountId={acc.id} />
          </div>
        </div>
        {onDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {accProfiles.map((p: any, i: number) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onView(p, i + 1)}
            className="group flex flex-col items-center gap-3 rounded-2xl p-4 hover:bg-muted/40 transition"
          >
            <div className="h-20 w-20">
              <ProfileAvatar id={p.avatar} name={p.profile_name} className="h-20 w-20 text-2xl" />
            </div>
            <div className="text-center">
              <p className="font-semibold leading-tight">{p.profile_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{p.pseudo || `Profil ${i + 1}`}</p>
            </div>
          </button>
        ))}
        {accProfiles.length < capacity && (
          <button
            type="button"
            onClick={onNewProfile}
            className="flex flex-col items-center gap-3 rounded-2xl p-4 hover:bg-muted/40 transition"
          >
            <div className="h-20 w-20 rounded-xl grid place-items-center border-2 border-dashed border-muted-foreground/40 text-muted-foreground group-hover:border-[#E50914] group-hover:text-[#E50914]">
              <Plus className="h-8 w-8" />
            </div>
            <p className="text-sm text-muted-foreground">Ajouter</p>
          </button>
        )}
      </div>
    </section>
  );
}

function ProfileIdentity({ account, profile, slot, onEdit, onDelete, onChangeIcon }: any) {
  const exp = computeExpiration(profile.start_date, profile.duration_days);
  const fin = new Date(new Date(profile.start_date).getTime() + profile.duration_days * 24 * 60 * 60 * 1000);

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <button type="button" onClick={onChangeIcon} className="h-12 w-12 shrink-0" title="Changer l'icône">
            <ProfileAvatar id={profile.avatar} name={profile.profile_name} className="h-12 w-12 text-lg" />
          </button>
          {profile.profile_name}
        </DialogTitle>
      </DialogHeader>

      <table className="w-full text-sm">
        <tbody>
          <IdRow label="Pseudo" value={profile.profile_name} />
          <IdRow label="Profil Netflix" value={profile.pseudo || `Profil ${slot}`} />
          <tr className="border-b border-border/60">
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-muted-foreground w-[42%]">PIN</td>
            <td className="py-2.5"><SecretValue value={profile.pin} /></td>
          </tr>
          <IdRow label="Date d'abonnement" value={formatDate(profile.start_date)} />
          <IdRow label="Durée" value={durationLabel(profile.duration_days)} />
          <IdRow label="Fin" value={formatDate(fin.toISOString())} />
          <tr className="border-b border-border/60">
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-muted-foreground">Statut</td>
            <td className={cn("py-2.5 font-medium", exp.status === "expired" ? "text-destructive" : exp.status === "soon" ? "text-warning" : "text-success")}>
              {exp.status === "expired" ? "Expiré" : exp.label}
            </td>
          </tr>
          <IdRow label="Montant" value={formatMoney(profile.price)} />
          <tr>
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-muted-foreground">Mot de passe</td>
            <td className="py-2.5"><AccountPassword service="netflix" accountId={account.id} /></td>
          </tr>
        </tbody>
      </table>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-1" /> Supprimer
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onChangeIcon}>Changer l'icône</Button>
          <Button type="button" variant="outline" onClick={onEdit} className="gap-1">
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-border/60">
      <td className="py-2.5 pr-4 text-xs uppercase tracking-wider text-muted-foreground w-[42%]">{label}</td>
      <td className="py-2.5 font-medium">{value || "—"}</td>
    </tr>
  );
}

function SecretValue({ value }: { value: string | null | undefined }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <button type="button" onClick={() => setShow(!show)} className="inline-flex items-center gap-2 hover:text-foreground">
      <span className="tracking-widest font-medium">{show ? value : "••••"}</span>
      {show ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
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
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-[#E50914] text-white hover:bg-[#E50914]/90">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function ProfileForm({ initial, avatar, onPickIcon, onSubmit, submitting, onCancel }: any) {
  const [v, setV] = useState({
    profile_name: initial?.profile_name ?? "",
    pin: initial?.pin ?? "",
    pseudo: initial?.pseudo ?? "",
    avatar: avatar ?? initial?.avatar ?? "00",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? 31),
    price: String(initial?.price ?? 3000),
    method: PAYMENT_METHODS[0]!.value as string,
    record_payment: false,
  });
  useEffect(() => {
    if (avatar) setV((s) => ({ ...s, avatar }));
  }, [avatar]);
  const durationValue = DURATIONS.some((d) => String(d.days) === v.duration_days) ? v.duration_days : "31";
  const avatarId = avatar ?? v.avatar;

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="uppercase tracking-wide">{initial ? "Modifier l'abonné" : "Nouvel abonné"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...v, duration_days: durationValue, avatar: avatarId }); }} className="grid grid-cols-2 gap-4">
        <button type="button" onClick={onPickIcon} className="col-span-2 flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-[#E50914]/60">
          <ProfileAvatar id={avatarId} name={v.profile_name} className="h-14 w-14 text-xl" />
          <div>
            <p className="text-sm font-medium">Icône de profil</p>
            <p className="text-xs text-muted-foreground">Cliquer pour personnaliser</p>
          </div>
        </button>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Pseudo</Label>
          <Input required value={v.profile_name} onChange={(e) => setV({ ...v, profile_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Profil Netflix</Label>
          <Input value={v.pseudo} onChange={(e) => setV({ ...v, pseudo: e.target.value })} placeholder="Profil 1" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Code PIN (4 chiffres)</Label>
          <Input value={v.pin} onChange={(e) => setV({ ...v, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} maxLength={4} inputMode="numeric" className="tracking-[0.4em]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Date d'abonnement</Label>
          <Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Durée</Label>
          <Select value={durationValue} onValueChange={(days) => setV({ ...v, duration_days: days })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DURATIONS.map((d) => <SelectItem key={d.days} value={String(d.days)}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Montant</Label>
          <Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
        </div>
        <PaymentFields isEdit={!!initial} method={v.method} onMethod={(m: string) => setV({ ...v, method: m })} recordPayment={v.record_payment} onRecordPayment={(b: boolean) => setV({ ...v, record_payment: b })} />
        <DialogFooter className="col-span-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
          <Button type="submit" disabled={submitting} className="bg-[#E50914] text-white hover:bg-[#E50914]/90">{submitting ? "…" : "Enregistrer"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function IconPicker({ forName, selected, onPick }: { forName: string; selected?: string; onPick: (id: string) => void }) {
  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-none">
      <DialogHeader>
        <DialogTitle>Choisissez une icône de profil</DialogTitle>
        <p className="text-sm text-muted-foreground">Pour {forName}</p>
      </DialogHeader>
      <AvatarGrid selected={selected} onPick={onPick} accent="netflix" />
    </DialogContent>
  );
}
