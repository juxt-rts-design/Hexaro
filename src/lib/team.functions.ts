import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden");
}

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const users = usersPage?.users ?? [];
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
    }));
  });

const createManagerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(120),
});

export const createManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createManagerSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created?.user) throw new Error(error?.message ?? "Création impossible");
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "manager" });
    return { ok: true, id: created.user.id };
  });

export const deleteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Impossible de supprimer votre propre compte");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Vérifier que ce n'est pas un admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    if ((roles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Un administrateur ne peut pas être supprimé");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
