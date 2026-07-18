import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Film, Music2, Wifi, AlertTriangle, TrendingUp, Wallet, Clock, RefreshCw, Trash2 } from "lucide-react";
import { formatMoney, computeExpiration, formatDateTime } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/confirm-provider";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord — Hexaro" }] }),
  component: Dashboard,
});

type Sub = { id: string; start_date: string; duration_days: number; price: number | string; status?: string };

function Dashboard() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const confirmAction = useConfirm();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [nfp, spm, isub, logs] = await Promise.all([
        supabase.from("netflix_profiles").select("id, start_date, duration_days, price, status"),
        supabase.from("spotify_members").select("id, start_date, duration_days, price, status"),
        supabase.from("internet_subscriptions").select("id, start_date, duration_days, price, status"),
        supabase.from("activity_logs").select("action, actor_email, entity_type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      return {
        netflix: (nfp.data ?? []) as Sub[],
        spotify: (spm.data ?? []) as Sub[],
        internet: (isub.data ?? []) as Sub[],
        logs: logs.data ?? [],
      };
    },
  });

  const isActive = (s: Sub) => computeExpiration(s.start_date, s.duration_days).status !== "expired";
  const sumPrice = (arr: Sub[]) => arr.reduce((a, s) => a + Number(s.price ?? 0), 0);

  const activeNetflix = (data?.netflix ?? []).filter(isActive);
  const activeSpotify = (data?.spotify ?? []).filter(isActive);
  const activeInternet = (data?.internet ?? []).filter(isActive);
  const allActive = [...activeNetflix, ...activeSpotify, ...activeInternet];
  const allSubs = [...(data?.netflix ?? []), ...(data?.spotify ?? []), ...(data?.internet ?? [])];

  const expired = allSubs.filter((s) => computeExpiration(s.start_date, s.duration_days).status === "expired").length;
  const soon = allSubs.filter((s) => computeExpiration(s.start_date, s.duration_days).status === "soon").length;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  // Revenus = somme des prix des abonnements ACTIFS (comptes qui rapportent aujourd'hui)
  const revTotalActive = sumPrice(allActive);
  const revMonthActive = sumPrice(allActive.filter((s) => new Date(s.start_date) >= monthAgo));
  const revWeekActive = sumPrice(allActive.filter((s) => new Date(s.start_date) >= weekAgo));
  const revTodayActive = sumPrice(allActive.filter((s) => new Date(s.start_date) >= today));

  // Chart 14 derniers jours : chiffre d'affaires généré (start_date) parmi abonnements ACTIFS
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = sumPrice(allActive.filter((s) => new Date(s.start_date) >= d && new Date(s.start_date) < next));
    return { day: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }), total };
  });

  const purge = useMutation({
    mutationFn: async () => {
      // Supprime tous les paiements historiques + logs (données de test)
      await supabase.from("payments").delete().gte("amount", 0);
      await supabase.from("activity_logs").delete().not("id", "is", null);
    },
    onSuccess: () => {
      toast.success("Historique remis à zéro");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour, ${displayName}`}
        description="Vue en temps réel — les revenus n'incluent que les abonnements actifs."
        actions={
          <>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: "Purger l'historique ?",
                    description: "Cela supprime définitivement tout l'historique des paiements et du journal (données de test). Les abonnements actifs restent intacts.",
                    destructive: true,
                    confirmLabel: "Purger",
                  });
                  if (ok) purge.mutate();
                }}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Purger l'historique
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Netflix actifs" value={activeNetflix.length} icon={Film} tone="brand" />
        <StatCard label="Spotify actifs" value={activeSpotify.length} icon={Music2} tone="success" />
        <StatCard label="Internet actifs" value={activeInternet.length} icon={Wifi} tone="warning" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Revenus actifs (total)" value={formatMoney(revTotalActive)} icon={Wallet} tone="brand" hint={`${allActive.length} abonnement${allActive.length > 1 ? "s" : ""}`} />
        <StatCard label="Nouveaux — aujourd'hui" value={formatMoney(revTodayActive)} icon={TrendingUp} />
        <StatCard label="Nouveaux — 7 jours" value={formatMoney(revWeekActive)} icon={TrendingUp} />
        <StatCard label="Nouveaux — 30 jours" value={formatMoney(revMonthActive)} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="hex-glass rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Chiffre d'affaires actif — 14 derniers jours</h3>
              <p className="text-xs text-muted-foreground">Basé uniquement sur les abonnements en cours</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any) => [formatMoney(v), "Revenus"]}
                />
                <Area type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2} fill="url(#grad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="hex-glass rounded-2xl p-5">
          <h3 className="font-semibold mb-1">Alertes</h3>
          <p className="text-xs text-muted-foreground mb-4">Abonnements à surveiller</p>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-warning/10 border border-warning/25">
              <Clock className="h-5 w-5 text-warning" />
              <div className="flex-1">
                <p className="text-sm font-medium">Expiration proche</p>
                <p className="text-xs text-muted-foreground">{soon} abonnement{soon > 1 ? "s" : ""} dans moins de 3 jours</p>
              </div>
              <span className="text-xl font-bold text-warning">{soon}</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/25">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div className="flex-1">
                <p className="text-sm font-medium">Expirés</p>
                <p className="text-xs text-muted-foreground">À renouveler ou supprimer</p>
              </div>
              <span className="text-xl font-bold text-destructive">{expired}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="hex-glass rounded-2xl p-5">
        <h3 className="font-semibold mb-4">Activité récente</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (data?.logs ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune activité pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data!.logs.map((l: any, i: number) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <div className="h-8 w-8 rounded-full bg-brand/15 grid place-items-center text-brand text-xs font-semibold">
                  {(l.actor_email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm"><span className="font-medium">{l.actor_email ?? "Système"}</span> · {l.action}{l.entity_type ? ` (${l.entity_type})` : ""}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(l.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
