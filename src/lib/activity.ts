import { supabase } from "@/integrations/supabase/client";

export type ActivityRow = {
  id: string;
  action: string;
  actor_email: string | null;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function metaLabel(meta: Record<string, unknown> | null | undefined) {
  const label = typeof meta?.label === "string" ? meta.label.trim() : "";
  return label || null;
}

export function describeActivity(row: Pick<ActivityRow, "action" | "entity_type" | "metadata">) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const who = metaLabel(meta);
  const quoted = who ? ` « ${who} »` : "";
  const key = row.action || `${row.entity_type ?? ""}.${meta.op ?? ""}`;

  const map: Record<string, string> = {
    "user.signin": "s’est connecté",
    "team.manager_created": "a créé un manager",
    "team.access_blocked": "a bloqué un accès",
    "team.access_restored": "a rétabli un accès",
    "team.member_deleted": "a retiré un membre",
    "netflix_profiles.insert": `a créé un profil Netflix${quoted}`,
    "netflix_profiles.update": `a modifié un profil Netflix${quoted}`,
    "netflix_profiles.delete": `a supprimé un profil Netflix${quoted}`,
    "netflix_accounts.insert": `a ajouté un compte Netflix${quoted}`,
    "netflix_accounts.update": `a modifié un compte Netflix${quoted}`,
    "netflix_accounts.delete": `a supprimé un compte Netflix${quoted}`,
    "spotify_members.insert": `a ajouté un membre Spotify${quoted}`,
    "spotify_members.update": `a modifié un membre Spotify${quoted}`,
    "spotify_members.delete": `a supprimé un membre Spotify${quoted}`,
    "spotify_accounts.insert": `a ajouté un compte Spotify${quoted}`,
    "spotify_accounts.update": `a modifié un compte Spotify${quoted}`,
    "spotify_accounts.delete": `a supprimé un compte Spotify${quoted}`,
    "internet_subscriptions.insert": `a créé un abonnement Internet${quoted}`,
    "internet_subscriptions.update": `a modifié un abonnement Internet${quoted}`,
    "internet_subscriptions.delete": `a supprimé un abonnement Internet${quoted}`,
    "service_subscriptions.insert": `a créé un abonnement${quoted}`,
    "service_subscriptions.update": `a modifié un abonnement${quoted}`,
    "service_subscriptions.delete": `a supprimé un abonnement${quoted}`,
    "payments.insert": `a enregistré un paiement${quoted}`,
    "payments.update": `a corrigé un paiement${quoted}`,
    "payments.void": `a retiré un paiement de l’historique${quoted}`,
    "services.insert": `a ajouté un service${quoted}`,
    "services.update": `a modifié un service${quoted}`,
    "services.delete": `a supprimé un service${quoted}`,
  };

  return map[key] ?? row.action.replace(/[._]/g, " ");
}

export async function logActivity(input: {
  action: string;
  entity_type?: string;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("activity_logs").insert({
    action: input.action,
    actor_id: auth.user?.id ?? null,
    actor_email: auth.user?.email ?? null,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    metadata: input.metadata ?? null,
  });
}
