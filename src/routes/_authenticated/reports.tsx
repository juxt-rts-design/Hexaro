import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate, computeExpiration } from "@/lib/hexaro";
import { Wallet, TrendingUp, Download, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Fiches & Rapports — Hexaro" }] }),
  component: ReportsPage,
});

type Range = "day" | "week" | "month" | "year" | "all";
type Row = { id: string; service: string; client: string; start_date: string; duration_days: number; price: number; active: boolean };

function ReportsPage() {
  const [range, setRange] = useState<Range>("month");
  const [onlyActive, setOnlyActive] = useState(true);
  const [detailed, setDetailed] = useState(true);

  const { data } = useQuery({
    queryKey: ["reports_subs"],
    queryFn: async () => {
      const [nf, sp, it] = await Promise.all([
        supabase.from("netflix_profiles").select("id, profile_name, start_date, duration_days, price"),
        supabase.from("spotify_members").select("id, member_name, start_date, duration_days, price"),
        supabase.from("internet_subscriptions").select("id, client_name, start_date, duration_days, price"),
      ]);
      const rows: Row[] = [
        ...(nf.data ?? []).map((r: any) => ({ id: r.id, service: "netflix", client: r.profile_name, start_date: r.start_date, duration_days: r.duration_days, price: Number(r.price), active: computeExpiration(r.start_date, r.duration_days).status !== "expired" })),
        ...(sp.data ?? []).map((r: any) => ({ id: r.id, service: "spotify", client: r.member_name, start_date: r.start_date, duration_days: r.duration_days, price: Number(r.price), active: computeExpiration(r.start_date, r.duration_days).status !== "expired" })),
        ...(it.data ?? []).map((r: any) => ({ id: r.id, service: "internet", client: r.client_name, start_date: r.start_date, duration_days: r.duration_days, price: Number(r.price), active: computeExpiration(r.start_date, r.duration_days).status !== "expired" })),
      ];
      return rows;
    },
  });
  const rows = data ?? [];

  const now = new Date();
  const start = new Date(now);
  if (range === "day") start.setHours(0, 0, 0, 0);
  else if (range === "week") start.setDate(start.getDate() - 7);
  else if (range === "month") start.setDate(start.getDate() - 30);
  else if (range === "year") start.setFullYear(start.getFullYear() - 1);
  else start.setFullYear(1970);

  let filtered = rows.filter((r) => new Date(r.start_date) >= start);
  if (onlyActive) filtered = filtered.filter((r) => r.active);
  const total = filtered.reduce((a, r) => a + r.price, 0);

  const byService: Record<string, { count: number; total: number }> = {};
  filtered.forEach((r) => {
    byService[r.service] = byService[r.service] || { count: 0, total: 0 };
    byService[r.service].count++;
    byService[r.service].total += r.price;
  });

  function exportCSV() {
    const csvRows = [
      ["Date début", "Service", "Client", "Durée (j)", "Prix (F)", "Statut"],
      ...filtered.map((r) => [formatDate(r.start_date), r.service, r.client, String(r.duration_days), String(r.price), r.active ? "actif" : "expiré"]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hexaro-rapport-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rangeLabel = { day: "Aujourd'hui", week: "7 derniers jours", month: "30 derniers jours", year: "12 derniers mois", all: "Tout l'historique" }[range];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiches & Rapports"
        description="Analyses détaillées, exports comptables et fiches prêtes à imprimer."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer className="h-4 w-4" /> Imprimer</Button>
            <Button onClick={exportCSV} className="bg-brand text-brand-foreground gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
          </>
        }
      />

      <div className="hex-glass rounded-2xl p-4 flex flex-wrap items-center gap-2">
        {(["day", "week", "month", "year", "all"] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${range === r ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}>
            {{ day: "Jour", week: "Semaine", month: "Mois", year: "Année", all: "Tout" }[r]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            Comptes actifs uniquement
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} />
            Vue détaillée
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={`Revenus — ${rangeLabel}`} value={formatMoney(total)} icon={Wallet} tone="brand" hint={onlyActive ? "actifs seulement" : "tous statuts"} />
        <StatCard label="Abonnements" value={filtered.length} icon={TrendingUp} />
        <StatCard label="Panier moyen" value={formatMoney(filtered.length ? total / filtered.length : 0)} icon={TrendingUp} tone="success" />
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Répartition par service</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(byService).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{k}</p>
              <p className="text-2xl font-bold mt-1">{formatMoney(v.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">{v.count} abonnement{v.count > 1 ? "s" : ""}</p>
            </div>
          ))}
          {Object.keys(byService).length === 0 && <p className="text-sm text-muted-foreground">Aucun abonnement sur cette période.</p>}
        </div>
      </div>

      {detailed && (
        <div className="hex-glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Détail des abonnements</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Date début</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Durée</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2 pr-4 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Aucun abonnement.</td></tr>}
                {filtered.map((r) => (
                  <tr key={`${r.service}-${r.id}`} className="border-b border-border/50">
                    <td className="py-2 pr-4">{formatDate(r.start_date)}</td>
                    <td className="py-2 pr-4 capitalize">{r.service}</td>
                    <td className="py-2 pr-4">{r.client}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.duration_days}j</td>
                    <td className="py-2 pr-4">{r.active ? <span className="text-success">Actif</span> : <span className="text-destructive">Expiré</span>}</td>
                    <td className="py-2 pr-4 text-right font-medium">{formatMoney(r.price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={5} className="py-3">Total</td>
                  <td className="py-3 text-right text-brand">{formatMoney(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
