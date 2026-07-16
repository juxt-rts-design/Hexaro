import { createServerFn } from "@tanstack/react-start";

// Crée idempotemment le compte administrateur Hexaro au premier démarrage.
// Endpoint public par nécessité : le premier admin doit être provisionné
// avant qu'il n'existe une session. La fonction ne fait qu'insérer le compte
// s'il n'existe pas déjà, et échoue silencieusement autrement.
export const ensureAdminSeeded = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const ADMIN_EMAIL = "hexaro@gmail.com";
  const ADMIN_PASSWORD = "jux@trts123!";

  // Existe déjà ?
  const { data: existing } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (existing) return { ok: true, created: false };

  // Chercher l'user via listUsers (paginé, mais 0 users au démarrage)
  const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
  let adminUser = usersPage?.users.find((u) => u.email === ADMIN_EMAIL);

  if (!adminUser) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Administrateur Hexaro" },
    });
    if (error || !created?.user) return { ok: false, error: error?.message ?? "create failed" };
    adminUser = created.user;
  }

  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: adminUser.id, role: "admin" }, { onConflict: "user_id,role" });

  return { ok: true, created: true };
});
