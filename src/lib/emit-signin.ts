import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const DEBOUNCE_MS = 3 * 60_000;
const lastEmit = new Map<string, number>();

/** Une seule ligne `user.signin` par personne, même si SIGNED_IN part deux fois. */
export async function emitSignInNotice(user: User) {
  const now = Date.now();
  const prevMem = lastEmit.get(user.id) ?? 0;
  if (now - prevMem < DEBOUNCE_MS) return;
  lastEmit.set(user.id, now);

  const storageKey = `hexaro-signin:${user.id}`;
  if (typeof sessionStorage !== "undefined") {
    const last = Number(sessionStorage.getItem(storageKey) ?? 0);
    if (last && now - last < DEBOUNCE_MS) return;
  }

  const since = new Date(now - DEBOUNCE_MS).toISOString();
  const { data: recent } = await supabase
    .from("activity_logs")
    .select("id")
    .eq("action", "user.signin")
    .eq("actor_id", user.id)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) return;

  const email = user.email ?? "Un utilisateur";
  const fullName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) || email;
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");

  const { error } = await supabase.from("activity_logs").insert({
    action: "user.signin",
    actor_id: user.id,
    actor_email: email,
    entity_type: "auth",
    metadata: { full_name: fullName, admin: isAdmin },
  });
  if (error) {
    lastEmit.delete(user.id);
    throw error;
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(storageKey, String(now));
  }
}
