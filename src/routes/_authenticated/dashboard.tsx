import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Film, Music2, Wifi, AlertTriangle, TrendingUp, Wallet, Clock } from "lucide-react";
import { formatMoney, computeExpiration, formatDateTime } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
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

function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [nfp, spm, isub, pays, logs] = await Promise.all([
        supabase.from("netflix_profiles").select("id, start_date, duration_days, status"),
        supabase.from("spotify_members").select("id, start_date, duration_days, status"),
        supabase.from("internet_subscriptions").select("id, start_date, duration_days, status"),
        supabase.from("payments").select("amount, paid_at, service_slug").order("paid_at", { ascending: false }),
        supabase.from("activity_logs").select("action, actor_email, entity_type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      return {
        netflix: nfp.data ?? [],
        spotify: spm.data ?? [],
        internet: isub.data ?? [],
        payments: pays.data ?? [],
        logs: logs.data ?? [],
      };
    },
  });

  const active = {
    netflix: (data?.netflix ?? []).filter((n) => computeExpiration(n.start_date, n.duration_days).status !== "expired").length,
    spotify: (data?.spotify ?? []).filter((n) => computeExpiration(n.start_date, n.duration_days).status !== "expired").length,
    internet: (data?.internet ?? []).filter((n) => computeExpiration(n.start_date, n.duration_days).status !== "expired").length,
  };
  const allSubs = [...(data?.netflix ?? []), ...(data?.spotify ?? []), ...(data?.internet ?? [])];
  const expired = allSubs.filter((s) => computeExpiration(s.start_date, s.duration_days).status === "expired").length;
  const soon = allSubs.filter((s) => computeExpiration(s.start_date, s.duration_days).status === "soon").length;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  const sum = (arr: Array<{ amount: number | string }>) => (arr ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const payments = data?.payments ?? [];
  const revToday = sum(payments.filter((p) => new Date(p.paid_at) >= today));
  const revWeek = sum(payments.filter((p) => new Date(p.paid_at) >= weekAgo));
  const revMonth = sum(payments.filter((p) => new Date(p.paid_at) >= monthAgo));

  // Chart data: last 14 days
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = sum(payments.filter((p) => new Date(p.paid_at) >= d && new Date(p.paid_at) < next));
    return { day: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }), total };
  });

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour, ${displayName} 👋`}
        description="Voici l'état de votre business Hexaro en temps réel."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Clients" value={data?.clientsCount ?? "—"} icon={Users} />
        <StatCard label="Netflix actifs" value={active.netflix} icon={Film} tone="brand" />
        <StatCard label="Spotify actifs" value={active.spotify} icon={Music2} tone="success" />
        <StatCard label="Internet actifs" value={active.internet} icon={Wifi} tone="warning" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Revenus aujourd'hui" value={formatMoney(revToday)} icon={Wallet} tone="brand" hint={`${payments.filter((p) => new Date(p.paid_at) >= today).length} paiements`} />
        <StatCard label="Revenus semaine" value={formatMoney(revWeek)} icon={TrendingUp} />
        <StatCard label="Revenus mois" value={formatMoney(revMonth)} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="hex-glass rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Revenus des 14 derniers jours</h3>
              <p className="text-xs text-muted-foreground">Tous services confondus</p>
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
