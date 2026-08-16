import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate, formatDateTime, computeExpiration } from "@/lib/hexaro";
import { methodLabel, voidPayment } from "@/lib/payments";
import { Wallet, Users, CheckCircle2, PauseCircle, FileText, Printer, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useServices } from "@/lib/services";
import { buildFicheTechniqueHtml } from "@/lib/fiche-technique";
import { useConfirm } from "@/components/confirm-provider";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Fiches & Rapports — Hexaro" },
      { name: "description", content: "Fiches techniques et suivi des abonnements Hexaro." },
    ],
  }),
  component: ReportsPage,
});

type Range = "day" | "week" | "month" | "year" | "all";
type SubRow = {
  id: string;
  service: string;
  client: string;
  start_date: string;
  duration_days: number;
  price: number;
  status?: string;
};
type PayRow = { id: string; service: string; client: string; amount: number; paid_at: string; method: string; kind: string };
type ServiceTotals = { [slug: string]: { count: number; total: number } };

const PAGE_SIZE = 10;

function ReportsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const { data: catalog = [] } = useServices();
  const [range, setRange] = useState<Range>("all");
  const [service, setService] = useState<string>("all");
  const [ficheHtml, setFicheHtml] = useState<string | null>(null);
  const [payPage, setPayPage] = useState(1);
  const [subPage, setSubPage] = useState(1);
  const ficheFrame = useRef<HTMLIFrameElement>(null);

  const labelOf = (slug: string) => catalog.find((s) => s.slug === slug)?.name ?? slug;

  const { data } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const [nf, sp, it, custom, pay, svcs] = await Promise.all([
        supabase.from("netflix_profiles").select("id, profile_name, start_date, duration_days, price, status"),
        supabase.from("spotify_members").select("id, member_name, start_date, duration_days, price, status"),
        supabase.from("internet_subscriptions").select("id, client_name, start_date, duration_days, price, status"),
        supabase.from("service_subscriptions").select("id, client_name, start_date, duration_days, price, status, service_id"),
        supabase.from("payments").select("id, amount, paid_at, service_slug, method, kind, client_name, voided_at").order("paid_at", { ascending: false }),
        supabase.from("services").select("id, slug"),
      ]);
      const toSub = (r: any, service: string, client: string): SubRow => ({
        id: r.id,
        service,
        client,
        start_date: r.start_date,
        duration_days: r.duration_days,
        price: Number(r.price),
        status: r.status,
      });
      const serviceById = new Map((svcs.data ?? []).map((s: { id: string; slug: string }) => [s.id, s.slug]));
      const customSubs: SubRow[] = ((custom.error ? [] : custom.data) ?? []).map((r: any) =>
        toSub(r, serviceById.get(r.service_id) ?? "autre", r.client_name),
      );
      const subs: SubRow[] = [
        ...(nf.data ?? []).map((r: any) => toSub(r, "netflix", r.profile_name)),
        ...(sp.data ?? []).map((r: any) => toSub(r, "spotify", r.member_name)),
        ...(it.data ?? []).map((r: any) => toSub(r, "internet", r.client_name)),
        ...customSubs,
      ].sort((a, b) => +new Date(b.start_date) - +new Date(a.start_date));
      const payments: PayRow[] = (pay.data ?? [])
        .filter((p: any) => !p.voided_at)
        .map((p: any) => ({
          id: p.id,
          service: p.service_slug,
          client: p.client_name ?? "—",
          amount: Number(p.amount),
          paid_at: p.paid_at,
          method: p.method,
          kind: p.kind,
        }));
      return { subs, payments };
    },
  });

  const voidPay = useMutation({
    mutationFn: (id: string) => voidPayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Paiement supprimé de l'historique");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const now = new Date();
  const start = new Date(now);
  if (range === "day") start.setHours(0, 0, 0, 0);
  else if (range === "week") start.setDate(start.getDate() - 7);
  else if (range === "month") start.setDate(start.getDate() - 30);
  else if (range === "year") start.setFullYear(start.getFullYear() - 1);
  else start.setFullYear(1970);

  const rangeLabel = { day: "Aujourd'hui", week: "7 derniers jours", month: "30 derniers jours", year: "12 derniers mois", all: "Tout l'historique" }[range];
  const inService = (s: string) => service === "all" || s === service;

  const periodSubs = (data?.subs ?? []).filter((r) => new Date(r.start_date) >= start && inService(r.service));
  const periodPays = (data?.payments ?? []).filter((p) => new Date(p.paid_at) >= start && inService(p.service));

  const solde = periodPays.reduce((a, p) => a + p.amount, 0);
  const isExpired = (r: SubRow) => computeExpiration(r.start_date, r.duration_days).status === "expired";
  const actifs = periodSubs.filter((r) => !isExpired(r) && r.status !== "suspended");
  const inactifs = periodSubs.filter((r) => !isExpired(r) && r.status === "suspended");

  const totals: ServiceTotals = {};
  for (const p of periodPays) {
    const cur = totals[p.service] ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += p.amount;
    totals[p.service] = cur;
  }
  const byService = Object.entries(totals).sort((a, b) => b[1].total - a[1].total);

  const payPageCount = Math.max(1, Math.ceil(periodPays.length / PAGE_SIZE));
  const curPayPage = Math.min(payPage, payPageCount);
  const pagedPays = periodPays.slice((curPayPage - 1) * PAGE_SIZE, curPayPage * PAGE_SIZE);
  const subPageCount = Math.max(1, Math.ceil(periodSubs.length / PAGE_SIZE));
  const curSubPage = Math.min(subPage, subPageCount);
  const pagedSubs = periodSubs.slice((curSubPage - 1) * PAGE_SIZE, curSubPage * PAGE_SIZE);

  const resetPages = () => { setPayPage(1); setSubPage(1); };

  const serviceFilters = [{ key: "all", label: "Tous" }, ...catalog.map((s) => ({ key: s.slug, label: s.name }))];

  function generateFiche() {
    try {
      const html = buildFicheTechniqueHtml({
        periodLabel: rangeLabel,
        serviceLabel: serviceFilters.find((s) => s.key === service)?.label ?? "Tous",
        generatedBy: user?.user_metadata?.full_name || user?.email || "Hexaro",
        subs: periodSubs.map((s) => ({
          ...s,
          serviceLabel: labelOf(s.service),
        })),
        payments: periodPays.map((p) => ({
          ...p,
          serviceLabel: labelOf(p.service),
        })),
      });
      setFicheHtml(html);
    } catch (err) {
      console.error(err);
      toast.error("Impossible de générer la fiche technique.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiches & Rapports"
        description={isAdmin
          ? "Filtrez la période et le service, puis générez une fiche technique. Vous seul pouvez retirer un paiement de l’historique."
          : "Consultez les encaissements et générez une fiche. L’historique ne peut pas être modifié."}
        actions={
          <Button type="button" onClick={generateFiche} className="bg-brand text-brand-foreground gap-2">
            <FileText className="h-4 w-4" /> Générer la fiche technique
          </Button>
        }
      />

      <div className="hex-glass rounded-2xl p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">Période</span>
        {(["day", "week", "month", "year", "all"] as Range[]).map((r) => (
          <button key={r} onClick={() => { setRange(r); resetPages(); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${range === r ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}>
            {{ day: "Jour", week: "Semaine", month: "Mois", year: "Année", all: "Tout" }[r]}
          </button>
        ))}
      </div>

      <div className="hex-glass rounded-2xl p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">Service</span>
        {serviceFilters.map((s) => (
          <button key={s.key} onClick={() => { setService(s.key); resetPages(); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${service === s.key ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Solde" value={<span className="uppercase">{formatMoney(solde)}</span>} icon={Wallet} tone="brand" />
        <StatCard label="Abonnements actifs" value={actifs.length} icon={CheckCircle2} tone="success" />
        <StatCard label="Total" value={periodSubs.length} icon={Users} />
        <StatCard label="Inactifs" value={inactifs.length} icon={PauseCircle} />
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Répartition du solde par service</h3>
        {byService.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun paiement sur cette sélection.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {byService.map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span className="text-muted-foreground">{labelOf(k)} ({v.count} paiement{v.count > 1 ? "s" : ""})</span>
                <span className="font-medium uppercase">{formatMoney(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Historique des paiements</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Service</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Méthode</th>
                <th className="py-2 pr-4 text-right">Montant</th>
                {isAdmin && <th className="py-2 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {periodPays.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="py-6 text-center text-muted-foreground">Aucun paiement.</td></tr>}
              {pagedPays.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-2 pr-4">{formatDateTime(p.paid_at)}</td>
                  <td className="py-2 pr-4">{labelOf(p.service)}</td>
                  <td className="py-2 pr-4">{p.client}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{p.kind === "renouvellement" ? "Renouvellement" : "Nouveau"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{methodLabel(p.method)}</td>
                  <td className="py-2 pr-4 text-right font-medium uppercase">{formatMoney(p.amount)}</td>
                  {isAdmin && (
                  <td className="py-2 pl-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={async () => {
                        if (await confirmAction({
                          title: "Supprimer ce paiement ?",
                          description: `${p.client} · ${formatMoney(p.amount)} sera retiré du solde.`,
                          destructive: true,
                          confirmLabel: "Supprimer",
                        })) voidPay.mutate(p.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold"><td colSpan={5} className="py-3">Solde</td><td className="py-3 text-right text-brand uppercase">{formatMoney(solde)}</td>{isAdmin && <td />}</tr>
            </tfoot>
          </table>
        </div>
        <Pagination page={curPayPage} pageCount={payPageCount} total={periodPays.length} onPage={setPayPage} />
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Historique des abonnements</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-4">Début</th>
                <th className="py-2 pr-4">Service</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Durée</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4 text-right">Prix</th>
              </tr>
            </thead>
            <tbody>
              {periodSubs.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Aucun abonnement.</td></tr>}
              {pagedSubs.map((r) => {
                const expired = isExpired(r);
                const inactive = !expired && r.status === "suspended";
                return (
                  <tr key={`${r.service}-${r.id}`} className="border-b border-border/50">
                    <td className="py-2 pr-4">{formatDate(r.start_date)}</td>
                    <td className="py-2 pr-4">{labelOf(r.service)}</td>
                    <td className="py-2 pr-4">{r.client}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.duration_days}j</td>
                    <td className="py-2 pr-4">
                      {expired ? <span className="text-destructive">Expiré</span> : inactive ? <span className="text-muted-foreground">Inactif</span> : <span className="text-success">Actif</span>}
                    </td>
                    <td className="py-2 pr-4 text-right font-medium uppercase">{formatMoney(r.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={curSubPage} pageCount={subPageCount} total={periodSubs.length} onPage={setSubPage} />
      </div>

      {ficheHtml && (
        <div className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-3 text-white">
            <h2 className="font-semibold">Fiche technique</h2>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => ficheFrame.current?.contentWindow?.print()} className="bg-brand text-brand-foreground gap-2">
                <Printer className="h-4 w-4" /> Imprimer / PDF
              </Button>
              <Button type="button" variant="outline" onClick={() => setFicheHtml(null)} className="gap-2 bg-background">
                <X className="h-4 w-4" /> Fermer
              </Button>
            </div>
          </div>
          <iframe
            ref={ficheFrame}
            title="Fiche technique Hexaro"
            srcDoc={ficheHtml}
            className="flex-1 w-full rounded-xl bg-white"
          />
        </div>
      )}
    </div>
  );
}

function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex items-center justify-between gap-3 mt-4 text-sm">
      <p className="text-muted-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} sur {total}</p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Précédent</Button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + 5).map((p) => (
          <button key={p} onClick={() => onPage(p)} className={`h-8 min-w-8 px-2 rounded-md text-sm font-medium transition ${p === page ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}>{p}</button>
        ))}
        <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Suivant</Button>
      </div>
    </div>
  );
}
