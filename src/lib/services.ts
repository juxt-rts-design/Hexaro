import { useQuery } from "@tanstack/react-query";
import { Film, Music2, Wifi, Package, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type HexaroService = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  is_builtin: boolean;
  description?: string | null;
  default_duration_days: number;
  default_price: number;
};

const BUILTIN_ORDER = ["netflix", "spotify", "internet"];

const BUILTIN_ICONS: Record<string, LucideIcon> = {
  netflix: Film,
  spotify: Music2,
  internet: Wifi,
};

const BUILTIN_PATHS: Record<string, string> = {
  netflix: "/netflix",
  spotify: "/spotify",
  internet: "/internet",
};

export function servicePath(slug: string) {
  return BUILTIN_PATHS[slug] ?? `/s/${slug}`;
}

export function serviceIcon(slug: string): LucideIcon {
  return BUILTIN_ICONS[slug] ?? Package;
}

export function sortServices(list: HexaroService[]) {
  return [...list].sort((a, b) => {
    const ia = BUILTIN_ORDER.indexOf(a.slug);
    const ib = BUILTIN_ORDER.indexOf(b.slug);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

export async function fetchServices() {
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, color, is_builtin, description, default_duration_days, default_price")
    .order("name");
  if (error) throw error;
  return sortServices((data ?? []) as HexaroService[]);
}

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
  });
}
