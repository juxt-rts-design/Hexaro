import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusPill, EmptyState, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Copy, Wallet } from "lucide-react";
import { toast } from "sonner";
import { computeExpiration, formatMoney, bySoonestExpiry } from "@/lib/hexaro";
import { useConfirm } from "@/components/confirm-provider";
import { recordPayment, syncLatestPaymentAmount, PAYMENT_METHODS, methodLabel } from "@/lib/payments";
import { PaymentFields } from "@/components/payment-fields";
import { useServices, serviceIcon } from "@/lib/services";
import { SERVICE_SUBSCRIPTIONS_SQL, isMissingTableError } from "@/lib/service-subs-setup";
import { PageClientFilter, useClientSearch } from "@/components/client-search";
import { clientMatches, searchHaystack } from "@/lib/client-search";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/s/$slug")({
  head: ({ params }) => ({ meta: [{ title: `${params.slug} — Hexaro` }] }),
  component: CustomServicePage,
});

function CustomServicePage() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const [open, setOpen] = useState<{ sub?: any } | null>(null);
  const [cash, setCash] = useState(false);
  const { query, openTarget, setOpenTarget } = useClientSearch();
  const { data: services = [], isPending: servicesPending } = useServices();
  const service = services.find((s) => s.slug === slug);
  const Icon = serviceIcon(slug);

  const { data: subState, isPending: subsPending } = useQuery({
    queryKey: ["service_subs", service?.id],
    enabled: Boolean(service?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_subscriptions")
        .select("*")
        .eq("service_id", service!.id)
        .order("created_at", { ascending: false });
      if (error) {
        if (isMissingTableError(error)) return { rows: [] as any[], missing: true };
        throw error;
      }
      return { rows: data ?? [], missing: false };
    },
  });
  const subs = subState?.rows ?? [];
  const tableMissing = Boolean(subState?.missing);

  const { data: pays = [] } = useQuery({
    queryKey: ["service_pays", slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, paid_at, client_name, method, voided_at")
        .eq("service_slug", slug)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((p) => !p.voided_at);
    },
  });
  const solde = pays.reduce((a, p) => a + Number(p.amount), 0);

  const upsert = useMutation({
    mutationFn: async (v: any) => {
      if (!service) throw new Error("Service introuvable");
      const payload = {
        service_id: service.id,
        client_name: v.client_name,
        phone: v.phone || null,
        account_email: v.account_email || null,
        account_password: v.account_password || null,
        start_date: v.start_date ? new Date(v.start_date).toISOString() : new Date().toISOString(),
        duration_days: parseInt(v.duration_days, 10) || 30,
        price: parseFloat(v.price) || 0,
        notes: v.notes || null,
      };
      const table = supabase.from("service_subscriptions");
      if (v.id) {
        const { error } = await table.update(payload).eq("id", v.id);
        if (error) throw error;
        if (v.record_payment && Number(payload.price) > 0) {
          await recordPayment({
            service_slug: slug,
            amount: Number(payload.price),
            method: v.method,
            kind: "renouvellement",
            subscription_id: v.id,
            subscription_type: "service_subscriptions",
            client_name: payload.client_name,
            reference: `Renouvellement ${service.name} — ${payload.client_name}`,
          });
        } else {
          await syncLatestPaymentAmount({
            service_slug: slug,
            amount: Number(payload.price),
            method: v.method,
            subscription_id: v.id,
            subscription_type: "service_subscriptions",
            client_name: payload.client_name,
            reference: `${service.name} — ${payload.client_name}`,
          });
        }
      } else {
        const { data, error } = await table.insert(payload).select("id").single();
        if (error) throw error;
        if (Number(payload.price) > 0) {
          await recordPayment({
            service_slug: slug,
            amount: Number(payload.price),
            method: v.method,
            kind: "nouveau",
            subscription_id: data.id,
            subscription_type: "service_subscriptions",
            client_name: payload.client_name,
            reference: `${service.name} — ${payload.client_name}`,
          });
        }
      }
    },
    onSuccess: (_d, v) => {
      void logActivity({
        action: v.id ? "service_subscriptions.update" : "service_subscriptions.insert",
        entity_type: "service_subscriptions",
        entity_id: v.id,
        metadata: { label: v.client_name },
      });
      qc.invalidateQueries({ queryKey: ["service_subs"] });
      qc.invalidateQueries({ queryKey: ["service_pays"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Abonnement enregistré — montant ajouté au solde");
      setOpen(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const encaisser = useMutation({
    mutationFn: async (v: { client_name: string; amount: string; method: string }) => {
      const amount = parseFloat(v.amount);
      if (!v.client_name.trim()) throw new Error("Indique le client");
      if (!(amount > 0)) throw new Error("Indique un montant");
      await recordPayment({
        service_slug: slug,
        amount,
        method: v.method as any,
        kind: "nouveau",
        subscription_id: crypto.randomUUID(),
        subscription_type: "service_revenue",
        client_name: v.client_name.trim(),
        reference: `Revenu ${service?.name ?? slug} — ${v.client_name.trim()}`,
      });
    },
    onSuccess: (_d, v) => {
      void logActivity({ action: "payments.insert", entity_type: "payments", metadata: { label: v.client_name } });
      qc.invalidateQueries({ queryKey: ["service_pays"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Montant ajouté au solde");
      setCash(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_subscriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      void logActivity({ action: "service_subscriptions.delete", entity_type: "service_subscriptions", entity_id: id });
      qc.invalidateQueries({ queryKey: ["service_subs"] });
      toast.success("Supprimé");
    },
  });

  if (!service && services.length > 0) {
    return (
      <EmptyState
        title="Service introuvable"
        description="Ce module n'existe pas (ou plus) dans votre espace."
      />
    );
  }

  const visible = useMemo(
    () => subs.filter((s) => clientMatches(searchHaystack(s.client_name, s.phone, s.account_email), query)).sort(bySoonestExpiry),
    [subs, query],
  );

  useEffect(() => {
    if (!openTarget || openTarget.slug !== slug) return;
    const found = subs.find((s) => s.id === openTarget.id);
    if (found) {
      setOpen({ sub: found });
      setOpenTarget(null);
    }
  }, [openTarget, slug, subs, setOpenTarget]);

  const activeCount = subs.filter((s) => computeExpiration(s.start_date, s.duration_days).status !== "expired").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-xl grid place-items-center bg-brand-soft text-brand">
              <Icon className="h-5 w-5" />
            </span>
            {service?.name ?? slug}
          </span>
        }
        description={`${activeCount} actif(s) · ${subs.length} au total`}
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCash(true)} className="gap-2">
              <Wallet className="h-4 w-4" /> Encaisser
            </Button>
            <Button onClick={() => setOpen({})} className="bg-brand text-brand-foreground gap-2" disabled={tableMissing}>
              <Plus className="h-4 w-4" /> Nouvel abonnement
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Solde de ce service" value={<span className="uppercase">{formatMoney(solde)}</span>} icon={Wallet} tone="brand" />
        <StatCard label="Encaissements" value={pays.length} />
      </div>

      {tableMissing && (
        <div className="hex-glass rounded-2xl p-5 space-y-3 border border-warning/40">
          <h3 className="font-semibold">Table manquante : service_subscriptions</h3>
          <p className="text-sm text-muted-foreground">
            Colle ce SQL dans le SQL Editor de Supabase, exécute, puis recharge cette page. Tu pourras alors créer des comptes.
            En attendant, tu peux déjà <strong>encaisser un montant</strong> : il va dans le solde.
          </p>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(SERVICE_SUBSCRIPTIONS_SQL);
              toast.success("SQL copié");
            }}
          >
            <Copy className="h-4 w-4" /> Copier le SQL
          </Button>
        </div>
      )}

      {pays.length > 0 && (
        <div className="hex-glass rounded-2xl p-5">
          <h3 className="font-semibold mb-3">Revenus ajoutés au solde</h3>
          <ul className="space-y-2 text-sm">
            {pays.slice(0, 8).map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground truncate">{p.client_name} · {methodLabel(p.method)}</span>
                <span className="font-medium uppercase">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PageClientFilter placeholder="Rechercher un client (nom, téléphone, email)…" />

      {tableMissing ? (
        <EmptyState title="Comptes indisponibles" description="Exécute le SQL ci-dessus, puis crée tes abonnements." />
      ) : servicesPending || subsPending ? null : subs.length === 0 ? (
        <EmptyState title="Aucun abonnement" description="Ajoute le premier client. Le montant saisi entre dans le solde." />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun client trouvé" description={`Aucun abonnement ne correspond à « ${query.trim()} ».`} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((s) => {
            const exp = computeExpiration(s.start_date, s.duration_days);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpen({ sub: s })}
                className="text-left hex-glass rounded-2xl p-5 group hover:border-brand/50 transition cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="font-semibold text-lg">{s.client_name}</p>
                  <StatusPill tone={exp.tone}>{exp.label}</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground">{s.account_email || s.phone || "—"}</p>
                <p className="mt-3 text-sm font-semibold uppercase">{formatMoney(s.price)}</p>
                <p className="text-xs text-muted-foreground">{s.duration_days} jours</p>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await confirmAction({
                          title: "Supprimer l'abonnement ?",
                          description: s.client_name,
                          destructive: true,
                          confirmLabel: "Supprimer",
                        })
                      ) {
                        del.mutate(s.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <Link to="/services" className="text-brand hover:underline">
          Gérer le catalogue
        </Link>
      </p>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <SubForm
            initial={open.sub}
            defaults={{
              duration_days: service?.default_duration_days ?? 30,
              price: service?.default_price ?? 0,
            }}
            onSubmit={(v: any) => upsert.mutate({ ...v, id: open.sub?.id })}
            submitting={upsert.isPending}
          />
        )}
      </Dialog>

      <Dialog open={cash} onOpenChange={setCash}>
        {cash && (
          <CashForm
            defaultPrice={service?.default_price ?? 0}
            submitting={encaisser.isPending}
            onSubmit={(v) => encaisser.mutate(v)}
          />
        )}
      </Dialog>
    </div>
  );
}

function CashForm({ defaultPrice, onSubmit, submitting }: { defaultPrice: number; onSubmit: (v: { client_name: string; amount: string; method: string }) => void; submitting: boolean }) {
  const [v, setV] = useState({
    client_name: "",
    amount: String(defaultPrice || ""),
    method: PAYMENT_METHODS[0]!.value as string,
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Encaisser un montant</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v);
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">Ce revenu entre directement dans le solde, comme Netflix ou Moov.</p>
        <div className="space-y-2">
          <Label>Client *</Label>
          <Input required value={v.client_name} onChange={(e) => setV({ ...v, client_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Montant (F) *</Label>
          <Input required type="number" min="1" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </div>
        <PaymentFields isEdit={false} method={v.method} onMethod={(m) => setV({ ...v, method: m })} recordPayment={false} onRecordPayment={() => {}} />
        <DialogFooter>
          <Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">
            {submitting ? "…" : "Ajouter au solde"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function SubForm({ initial, defaults, onSubmit, submitting }: any) {
  const [v, setV] = useState({
    client_name: initial?.client_name ?? "",
    phone: initial?.phone ?? "",
    account_email: initial?.account_email ?? "",
    account_password: initial?.account_password ?? "",
    start_date: initial?.start_date ? new Date(initial.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    duration_days: String(initial?.duration_days ?? defaults?.duration_days ?? 30),
    price: String(initial?.price ?? defaults?.price ?? 0),
    notes: initial?.notes ?? "",
    method: PAYMENT_METHODS[0]!.value as string,
    record_payment: false,
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initial ? "Modifier l'abonnement" : "Nouvel abonnement"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v);
        }}
        className="grid grid-cols-2 gap-3"
      >
        <div className="space-y-2 col-span-2">
          <Label>Nom du client *</Label>
          <Input required value={v.client_name} onChange={(e) => setV({ ...v, client_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Téléphone</Label>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Email du compte</Label>
          <Input type="email" value={v.account_email} onChange={(e) => setV({ ...v, account_email: e.target.value })} />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Mot de passe du compte</Label>
          <Input type="password" value={v.account_password} onChange={(e) => setV({ ...v, account_password: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Durée (j)</Label>
          <Input type="number" min="1" value={v.duration_days} onChange={(e) => setV({ ...v, duration_days: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Montant (F) — solde</Label>
          <Input type="number" min="0" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Date début</Label>
          <Input type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
        </div>
        <PaymentFields
          isEdit={!!initial}
          method={v.method}
          onMethod={(m) => setV({ ...v, method: m })}
          recordPayment={v.record_payment}
          onRecordPayment={(b) => setV({ ...v, record_payment: b })}
        />
        <DialogFooter className="col-span-2">
          <Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">
            {submitting ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
