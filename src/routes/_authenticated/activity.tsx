import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { formatDateTime } from "@/lib/hexaro";
import { Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { describeActivity } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Journal — Hexaro" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const { isAdmin, loading } = useAuth();
  const [actor, setActor] = useState("all");

  const { data = [], isPending } = useQuery({
    queryKey: ["activity_full"],
    enabled: isAdmin,
    queryFn: async () =>
      (await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(400)).data ?? [],
  });

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data) {
      if (row.actor_id && row.actor_email) map.set(row.actor_id, row.actor_email);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data]);

  const visible = useMemo(
    () => (actor === "all" ? data : data.filter((row) => row.actor_id === actor)),
    [data, actor],
  );

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal d'activité"
        description="Toutes les créations, modifications et connexions de l’équipe."
        actions={
          actors.length > 0 ? (
            <select
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">Toute l’équipe</option>
              {actors.map(([id, email]) => (
                <option key={id} value={id}>{email}</option>
              ))}
            </select>
          ) : undefined
        }
      />
      {isPending ? null : visible.length === 0 ? (
        <EmptyState title="Aucune activité" description="Le journal se remplira dès qu’un manager créera ou modifiera un abonnement." />
      ) : (
        <div className="hex-glass rounded-2xl divide-y divide-border">
          {visible.map((l) => (
            <div key={l.id} className="flex items-center gap-4 px-5 py-3">
              <div className="h-9 w-9 rounded-full bg-brand/15 grid place-items-center text-brand">
                <Activity className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{l.actor_email ?? "Système"}</span>
                  {" "}
                  {describeActivity(l as any)}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTime(l.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
