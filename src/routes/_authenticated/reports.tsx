import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDateTime } from "@/lib/hexaro";
import { Wallet, TrendingUp, Download, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Fiches & Rapports — Hexaro" }] }),
  component: ReportsPage,
});

type Range = "day" | "week" | "month" | "year";

function ReportsPage() {
  const [range, setRange] = useState<Range>("month");
  const [detailed, setDetailed] = useState(true);

  const { data: payments = [] } = useQuery({
    queryKey: ["reports_payments"],
    queryFn: async () => (await supabase.from("payments").select("*").order("paid_at", { ascending: false })).data ?? [],
  });

  const now = new Date();
  const start = new Date(now);
  if (range === "day") start.setHours(0, 0, 0, 0);
  else if (range === "week") start.setDate(start.getDate() - 7);
  else if (range === "month") start.setDate(start.getDate() - 30);
  else start.setFullYear(start.getFullYear() - 1);

  const filtered = payments.filter((p) => new Date(p.paid_at) >= start);
  const total = filtered.reduce((a, p) => a + Number(p.amount), 0);

  const byService: Record<string, { count: number; total: number }> = {};
  filtered.forEach((p) => {
    const k = p.service_slug ?? "autre";
    byService[k] = byService[k] || { count: 0, total: 0 };
    byService[k].count++;
    byService[k].total += Number(p.amount);
  });

  function exportCSV() {
    const rows = [
      ["Date", "Service", "Référence", "Montant (F)"],
      ...filtered.map((p) => [formatDateTime(p.paid_at), p.service_slug ?? "", p.reference ?? "", String(p.amount)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hexaro-rapport-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() { window.print(); }

  const rangeLabel = { day: "Aujourd'hui", week: "7 derniers jours", month: "30 derniers jours", year: "12 derniers mois" }[range];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiches & Rapports"
        description="Analyses détaillées, exports comptables et fiches techniques prêtes à imprimer."
        actions={
          <>
            <Button variant="outline" onClick={printReport} className="gap-2"><Calendar className="h-4 w-4" /> Imprimer</Button>
            <Button onClick={exportCSV} className="bg-brand text-brand-foreground gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
          </>
        }
      />

      <div className="hex-glass rounded-2xl p-4 flex flex-wrap items-center gap-2">
        {(["day", "week", "month", "year"] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${range === r ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}>
            {{ day: "Jour", week: "Semaine", month: "Mois", year: "Année" }[r]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} />
            Vue détaillée
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={`Revenus — ${rangeLabel}`} value={formatMoney(total)} icon={Wallet} tone="brand" />
        <StatCard label="Transactions" value={filtered.length} icon={TrendingUp} />
        <StatCard label="Panier moyen" value={formatMoney(filtered.length ? total / filtered.length : 0)} icon={TrendingUp} tone="success" />
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Répartition par service</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(byService).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{k}</p>
              <p className="text-2xl font-bold mt-1">{formatMoney(v.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">{v.count} paiement{v.count > 1 ? "s" : ""}</p>
            </div>
          ))}
          {Object.keys(byService).length === 0 && <p className="text-sm text-muted-foreground">Aucun paiement sur cette période.</p>}
        </div>
      </div>

      {detailed && (
        <div className="hex-glass rounded-2xl p-5">
          <h3 className="font-semibold mb-4">Détail des transactions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Référence</th>
                  <th className="py-2 pr-4 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Aucune transaction.</td></tr>}
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{formatDateTime(p.paid_at)}</td>
                    <td className="py-2 pr-4 capitalize">{p.service_slug ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.reference ?? "—"}</td>
                    <td className="py-2 pr-4 text-right font-medium">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={3} className="py-3">Total</td>
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
