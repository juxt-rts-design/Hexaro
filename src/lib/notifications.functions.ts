import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Called by managers/admins after successful sign-in so admins get notified.
export const notifySignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = user?.user?.email ?? "Un utilisateur";
    const fullName = (user?.user?.user_metadata as any)?.full_name ?? email;

    // Skip notifying about admin self sign-in
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

    await supabaseAdmin.from("notifications").insert({
      recipient_id: null,
      type: "user.signin",
      title: isAdmin ? "Connexion administrateur" : "Connexion d'un manager",
      body: `${fullName} vient de se connecter`,
      meta: { user_id: context.userId, email, admin: isAdmin },
    });
    return { ok: true };
  });

export const markAllRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    return { ok: true };
  });

export const updateOwnProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        full_name: z.string().min(1).max(120).optional(),
        phone: z.string().max(40).optional().nullable(),
        bio: z.string().max(500).optional().nullable(),
        avatar_url: z.string().url().optional().nullable(),
      })
      .parse(v)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(data)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ password: z.string().min(8).max(128) }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
