import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchServices, type HexaroService } from "@/lib/services";
import { isMissingTableError } from "@/lib/service-subs-setup";

export function prefetchWorkspace(qc: QueryClient) {
  void qc.prefetchQuery({ queryKey: ["services"], queryFn: fetchServices });
  void qc.prefetchQuery({
    queryKey: ["nf_accounts"],
    queryFn: async () =>
      (await supabase.from("netflix_accounts").select("id, email, profiles_capacity, created_on, expires_on, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["nf_profiles"],
    queryFn: async () =>
      (await supabase.from("netflix_profiles").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["sp_accounts"],
    queryFn: async () =>
      (await supabase.from("spotify_accounts").select("id, email, seats, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["sp_members"],
    queryFn: async () =>
      (await supabase.from("spotify_members").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["internet_subs"],
    queryFn: async () =>
      (await supabase.from("internet_subscriptions").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["internet_forfaits"],
    queryFn: async () =>
      (await supabase.from("internet_forfaits").select("*").eq("is_active", true).order("price")).data ?? [],
  });
  void qc.prefetchQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
}

async function fetchDashboard() {
  const [nfp, spm, isub, ssub, pay] = await Promise.all([
    supabase.from("netflix_profiles").select("id, profile_name, start_date, duration_days, price, status"),
    supabase.from("spotify_members").select("id, member_name, start_date, duration_days, price, status"),
    supabase.from("internet_subscriptions").select("id, client_name, start_date, duration_days, price, status"),
    supabase.from("service_subscriptions").select("id, client_name, start_date, duration_days, price, status"),
    supabase.from("payments").select("id, amount, paid_at, voided_at, created_by").order("paid_at", { ascending: false }),
  ]);
  const custom = ssub.error ? [] : (ssub.data ?? []);
  return {
    subs: [
      ...((nfp.data ?? []).map((r) => ({ ...r, name: r.profile_name, service: "Netflix" }))),
      ...((spm.data ?? []).map((r) => ({ ...r, name: r.member_name, service: "Spotify" }))),
      ...((isub.data ?? []).map((r) => ({ ...r, name: r.client_name, service: "Internet" }))),
      ...(custom.map((r: { client_name?: string }) => ({ ...r, name: r.client_name, service: "Service" }))),
    ],
    payments: (pay.data ?? []).filter((p: { voided_at: string | null }) => !p.voided_at),
  };
}

export function prefetchPath(qc: QueryClient, path: string) {
  if (path.startsWith("/netflix")) {
    void qc.prefetchQuery({
      queryKey: ["nf_accounts"],
      queryFn: async () =>
        (await supabase.from("netflix_accounts").select("id, email, profiles_capacity, created_on, expires_on, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
    });
    void qc.prefetchQuery({
      queryKey: ["nf_profiles"],
      queryFn: async () =>
        (await supabase.from("netflix_profiles").select("*").order("created_at", { ascending: false })).data ?? [],
    });
  } else if (path.startsWith("/spotify")) {
    void qc.prefetchQuery({
      queryKey: ["sp_accounts"],
      queryFn: async () =>
        (await supabase.from("spotify_accounts").select("id, email, seats, status, notes, created_at").order("created_at", { ascending: false })).data ?? [],
    });
    void qc.prefetchQuery({
      queryKey: ["sp_members"],
      queryFn: async () =>
        (await supabase.from("spotify_members").select("*").order("created_at", { ascending: false })).data ?? [],
    });
  } else if (path.startsWith("/internet")) {
    void qc.prefetchQuery({
      queryKey: ["internet_subs"],
      queryFn: async () =>
        (await supabase.from("internet_subscriptions").select("*").order("created_at", { ascending: false })).data ?? [],
    });
    void qc.prefetchQuery({
      queryKey: ["internet_forfaits"],
      queryFn: async () =>
        (await supabase.from("internet_forfaits").select("*").eq("is_active", true).order("price")).data ?? [],
    });
  } else if (path === "/dashboard") {
    void qc.prefetchQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  } else if (path.startsWith("/s/")) {
    prefetchCustomService(qc, path.slice(3).split("/")[0] ?? "");
  }
}

export function prefetchCustomService(qc: QueryClient, slug: string) {
  if (!slug) return;
  void qc.ensureQueryData({ queryKey: ["services"], queryFn: fetchServices }).then((services) => {
    const service = services.find((s) => s.slug === slug);
    if (!service) return;
    void qc.prefetchQuery({
      queryKey: ["service_subs", service.id],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("service_subscriptions")
          .select("*")
          .eq("service_id", service.id)
          .order("created_at", { ascending: false });
        if (error) {
          if (isMissingTableError(error)) {
            return { rows: [] as unknown[], missing: true };
          }
          throw error;
        }
        return { rows: data ?? [], missing: false };
      },
    });
    void qc.prefetchQuery({
      queryKey: ["service_pays", slug],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("payments")
          .select("id, amount, paid_at, client_name, method, voided_at")
          .eq("service_slug", slug)
          .order("paid_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).filter((p) => !p.voided_at);
      },
    });
  });
}

export function preloadAppRoutes(
  router: { preloadRoute: (opts: { to: string; params?: { slug: string } }) => unknown },
  services: HexaroService[] = [],
) {
  void router.preloadRoute({ to: "/dashboard" });
  void router.preloadRoute({ to: "/netflix" });
  void router.preloadRoute({ to: "/spotify" });
  void router.preloadRoute({ to: "/internet" });
  void router.preloadRoute({ to: "/services" });
  void router.preloadRoute({ to: "/media" });
  void router.preloadRoute({ to: "/reports" });
  void router.preloadRoute({ to: "/activity" });
  void router.preloadRoute({ to: "/profile" });
  for (const s of services) {
    if (!s.is_builtin) void router.preloadRoute({ to: "/s/$slug", params: { slug: s.slug } });
  }
}
