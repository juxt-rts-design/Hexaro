import { supabase } from "@/integrations/supabase/client";
import { servicePath } from "@/lib/services";
import { isMissingTableError } from "@/lib/service-subs-setup";

export type ClientHit = {
  id: string;
  name: string;
  detail: string;
  slug: string;
  service: string;
  path: string;
  haystack: string;
};

export function normalizeSearch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchHaystack(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Lettre par lettre + chaque mot de la requête doit coller (préfixe ou mot entier). */
export function clientMatches(text: string, query: string) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const h = normalizeSearch(text);
  if (!h) return false;
  if (h.includes(q)) return true;
  const words = h.split(" ");
  return q.split(" ").every((qw) => words.some((w) => w === qw || w.startsWith(qw)));
}

export async function fetchClientHits(): Promise<ClientHit[]> {
  const [nf, sp, inet, custom, services] = await Promise.all([
    supabase.from("netflix_profiles").select("id, profile_name, pseudo"),
    supabase.from("spotify_members").select("id, member_name, pseudo"),
    supabase.from("internet_subscriptions").select("id, client_name, phone, sim_number"),
    supabase.from("service_subscriptions").select("id, client_name, phone, account_email, service_id"),
    supabase.from("services").select("id, name, slug"),
  ]);

  const svcById = new Map((services.data ?? []).map((s) => [s.id, s]));
  const hits: ClientHit[] = [];

  for (const p of nf.data ?? []) {
    const name = p.profile_name || "Profil";
    hits.push({
      id: p.id,
      name,
      detail: p.pseudo || "Netflix",
      slug: "netflix",
      service: "Netflix",
      path: "/netflix",
      haystack: searchHaystack(name, p.pseudo, "netflix"),
    });
  }

  for (const m of sp.data ?? []) {
    const name = m.member_name || "Membre";
    hits.push({
      id: m.id,
      name,
      detail: m.pseudo || "Spotify",
      slug: "spotify",
      service: "Spotify",
      path: "/spotify",
      haystack: searchHaystack(name, m.pseudo, "spotify"),
    });
  }

  for (const s of inet.data ?? []) {
    const name = s.client_name || "Abonné";
    hits.push({
      id: s.id,
      name,
      detail: [s.phone, s.sim_number].filter(Boolean).join(" · ") || "Internet Libertis",
      slug: "internet",
      service: "Internet Libertis",
      path: "/internet",
      haystack: searchHaystack(name, s.phone, s.sim_number, "libertis", "moov", "internet"),
    });
  }

  if (!custom.error || !isMissingTableError(custom.error)) {
    for (const s of custom.data ?? []) {
      const svc = svcById.get(s.service_id);
      const name = s.client_name || "Client";
      const slug = svc?.slug ?? "service";
      hits.push({
        id: s.id,
        name,
        detail: [s.phone, s.account_email, svc?.name].filter(Boolean).join(" · ") || "Service",
        slug,
        service: svc?.name ?? "Service",
        path: servicePath(slug),
        haystack: searchHaystack(name, s.phone, s.account_email, svc?.name, slug),
      });
    }
  }

  return hits.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
