import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { formatDateTime } from "@/lib/hexaro";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Journal — Hexaro" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const { data = [] } = useQuery({
    queryKey: ["activity_full"],
    queryFn: async () => (await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Journal d'activité" description="Historique des actions effectuées dans Hexaro." />
      {data.length === 0 ? (
        <EmptyState title="Aucune activité" description="Le journal se remplira au fur et à mesure des actions." />
      ) : (
        <div className="hex-glass rounded-2xl divide-y divide-border">
          {data.map((l: any) => (
            <div key={l.id} className="flex items-center gap-4 px-5 py-3">
              <div className="h-9 w-9 rounded-full bg-brand/15 grid place-items-center text-brand">
                <Activity className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm"><span className="font-medium">{l.actor_email ?? "Système"}</span> — {l.action}{l.entity_type ? ` · ${l.entity_type}` : ""}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(l.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
