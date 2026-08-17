import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { stripTags } from "@/lib/sanitize";

export const notifySignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = String(context.claims.email ?? "Un utilisateur");
    const [{ data: isAdmin }, { data: profile }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.from("profiles").select("full_name").eq("id", context.userId).maybeSingle(),
    ]);
    const fullName = profile?.full_name?.trim() || email;
    const { error } = await context.supabase.from("activity_logs").insert({
      action: "user.signin",
      actor_id: context.userId,
      actor_email: email,
      entity_type: "auth",
      metadata: { full_name: fullName, admin: Boolean(isAdmin) },
    });
    if (error) throw new Error("Impossible d’enregistrer la connexion.");
    return { ok: true };
  });

export const markAllRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", context.userId)
      .is("read_at", null);
    if (error) throw new Error("Impossible de marquer les notifications.");
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
        avatar_url: z
          .string()
          .max(80)
          .regex(/^[a-z0-9-]+$/)
          .optional()
          .nullable(),
      })
      .parse(v)
  )
  .handler(async ({ data, context }) => {
    const payload = {
      ...data,
      full_name: data.full_name != null ? stripTags(data.full_name).slice(0, 120) : undefined,
      phone: data.phone != null ? stripTags(data.phone).slice(0, 40) : data.phone,
      bio: data.bio != null ? stripTags(data.bio).slice(0, 500) : data.bio,
    };
    const { error } = await context.supabase
      .from("profiles")
      .update(payload)
      .eq("id", context.userId);
    if (error) throw new Error("Impossible de mettre à jour le profil.");
    return { ok: true };
  });

export const updateOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ password: z.string().min(8).max(128) }).parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.auth.updateUser({ password: data.password });
    if (error) throw new Error("Impossible de changer le mot de passe.");
    return { ok: true };
  });
