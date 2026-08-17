import { createServerFn } from "@tanstack/react-start";

export const ensureAdminSeeded = createServerFn({ method: "POST" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { assertRateLimit, clientIp } = await import("@/lib/rate-limit.server");
  assertRateLimit(`seed:${clientIp(getRequest())}`, 5, 60_000);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (existing) return { ok: true as const, created: false };

  const email = String(process.env.HEXARO_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = String(process.env.HEXARO_ADMIN_PASSWORD ?? "");
  if (!email || !email.includes("@") || password.length < 12) {
    return { ok: true as const, created: false };
  }

  const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
  let adminUser = usersPage?.users.find((u) => (u.email ?? "").toLowerCase() === email);

  if (!adminUser) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Administrateur Hexaro" },
    });
    if (error || !created?.user) return { ok: true as const, created: false };
    adminUser = created.user;
  }

  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: adminUser.id, role: "admin" }, { onConflict: "user_id,role" });

  return { ok: true as const, created: true };
});
