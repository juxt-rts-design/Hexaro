import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Layers, CheckCircle2, PauseCircle, Wallet, RefreshCw, Clock } from "lucide-react";
import { formatMoney, computeExpiration, formatDateTime, bySoonestExpiry } from "@/lib/hexaro";
import { useAuth, useMyProfile } from "@/hooks/useAuth";
import { describeActivity } from "@/lib/activity";
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

type Sub = {
  id: string;
  start_date: string;
  duration_days: number;
  price: number | string;
  status?: string;
  name?: string;
  service?: string;
};
type Payment = { id: string; amount: number | string; paid_at: string; voided_at: string | null; created_by?: string | null };

function Dashboard() {
  const { user, isAdmin, loading } = useAuth();
  const { data: me } = useMyProfile();

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [nfp, spm, isub, ssub, pay] = await Promise.all([
        supabase.from("netflix_profiles").select("id, profile_name, start_date, duration_days, price, status"),
        supabase.from("spotify_members").select("id, member_name, start_date, duration_days, price, status"),
        supabase.from("internet_subscriptions").select("id, client_name, start_date, duration_days, price, status"),
        supabase.from("service_subscriptions").select("id, client_name, start_date, duration_days, price, status"),
        supabase.from("payments").select("id, amount, paid_at, voided_at, created_by").order("paid_at", { ascending: false }),
      ]);
      const custom = ssub.error ? [] : (ssub.data ?? []);
      const subs: Sub[] = [
        ...((nfp.data ?? []).map((r) => ({ ...r, name: r.profile_name, service: "Netflix" }))),
        ...((spm.data ?? []).map((r) => ({ ...r, name: r.member_name, service: "Spotify" }))),
        ...((isub.data ?? []).map((r) => ({ ...r, name: r.client_name, service: "Internet" }))),
        ...(custom.map((r: { id: string; client_name?: string; start_date: string; duration_days: number; price: number | string; status?: string }) => ({
          ...r,
          name: r.client_name,
          service: "Service",
        }))),
      ];
      return {
        subs,
        payments: ((pay.data ?? []) as Payment[]).filter((p) => !p.voided_at),
      };
    },
  });

  const { data: myLogs = [] } = useQuery({
    queryKey: ["activity_mine", user?.id],
    enabled: Boolean(user?.id) && !isAdmin,
    queryFn: async () =>
      (await supabase
        .from("activity_logs")
        .select("id, action, actor_email, entity_type, metadata, created_at")
        .eq("actor_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(8)).data ?? [],
  });

  const allSubs = data?.subs ?? [];
  const payments = data?.payments ?? [];
  const sumPay = (arr: Payment[]) => arr.reduce((a, p) => a + Number(p.amount ?? 0), 0);

  const inactive = allSubs.filter(
    (s) => s.status === "suspended" && computeExpiration(s.start_date, s.duration_days).status !== "expired",
  );
  const active = allSubs.filter(
    (s) => s.status !== "suspended" && computeExpiration(s.start_date, s.duration_days).status !== "expired",
  );
  const soon = [...allSubs]
    .filter((s) => {
      if (s.status === "suspended") return false;
      const exp = computeExpiration(s.start_date, s.duration_days);
      return exp.status === "expired" || exp.days < 7;
    })
    .sort(bySoonestExpiry)
    .slice(0, 8);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const thisMonth = sumPay(payments.filter((p) => new Date(p.paid_at) >= monthStart));
  const prevMonth = sumPay(payments.filter((p) => new Date(p.paid_at) >= prevMonthStart && new Date(p.paid_at) < monthStart));
  const solde = sumPay(payments);
  const myMonth = sumPay(payments.filter((p) => p.created_by === user?.id && new Date(p.paid_at) >= monthStart));

  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const total = sumPay(payments.filter((p) => new Date(p.paid_at) >= d && new Date(p.paid_at) < next));
    return { day: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }), total };
  });

  const displayName = me?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";

  if (loading) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour, ${displayName}`}
        description={isAdmin
          ? "Vue d’ensemble des abonnements et du solde."
          : "Vos abonnements à suivre. L’historique des paiements reste protégé."}
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
          </Button>
        }
      />

      {isAdmin ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Solde" value={<span className="uppercase">{formatMoney(solde)}</span>} icon={Wallet} tone="brand" />
            <StatCard label="Abonnements actifs" value={active.length} icon={CheckCircle2} tone="success" />
            <StatCard label="Total" value={allSubs.length} icon={Layers} />
            <StatCard label="Inactifs" value={inactive.length} icon={PauseCircle} />
            <StatCard label="Ce mois" value={<span className="uppercase">{formatMoney(thisMonth)}</span>} icon={Wallet} tone="brand" />
            <StatCard label="Mois précédent" value={<span className="uppercase">{formatMoney(prevMonth)}</span>} icon={Wallet} />
          </div>
          <div className="hex-glass rounded-2xl p-5">
            <div className="mb-4">
              <h3 className="font-semibold">Encaissements — 14 derniers jours</h3>
            </div>
            <div className="h-72">
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
                    formatter={(v: number) => [formatMoney(v), "Encaissé"]}
                  />
                  <Area type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2} fill="url(#grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Abonnements actifs" value={active.length} icon={CheckCircle2} tone="success" />
            <StatCard label="À renouveler" value={soon.length} icon={Clock} tone="warning" />
            <StatCard label="Total" value={allSubs.length} icon={Layers} />
            <StatCard label="Mes encaissements (mois)" value={<span className="uppercase">{formatMoney(myMonth)}</span>} icon={Wallet} tone="brand" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="hex-glass rounded-2xl p-5">
              <h3 className="font-semibold mb-3">À renouveler bientôt</h3>
              {soon.length === 0 ? (
                <p className="text-sm text-muted-foreground">Rien d’urgent pour le moment.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {soon.map((s) => {
                    const exp = computeExpiration(s.start_date, s.duration_days);
                    return (
                      <li key={`${s.service}-${s.id}`} className="flex justify-between gap-3">
                        <span className="truncate">{s.name || "—"} <span className="text-muted-foreground">· {s.service}</span></span>
                        <span className={exp.status === "expired" ? "text-destructive" : "text-warning"}>{exp.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="hex-glass rounded-2xl p-5">
              <h3 className="font-semibold mb-3">Mes dernières actions</h3>
              {myLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Vos créations et modifications apparaîtront ici.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {myLogs.map((row) => (
                    <li key={row.id} className="flex justify-between gap-3">
                      <span className="truncate">{describeActivity(row as any)}</span>
                      <span className="text-muted-foreground shrink-0">{formatDateTime(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Raccourcis : <Link to="/netflix" className="text-brand hover:underline">Netflix</Link>
            {" · "}
            <Link to="/spotify" className="text-brand hover:underline">Spotify</Link>
            {" · "}
            <Link to="/internet" className="text-brand hover:underline">Internet</Link>
            {" · "}
            <Link to="/reports" className="text-brand hover:underline">Rapports</Link>
          </p>
        </>
      )}
    </div>
  );
}
