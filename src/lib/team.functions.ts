import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Cette action est réservée à l’administrateur.");
}

function teamError(err: unknown, fallback = "Une erreur s’est produite.") {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/already been registered|already registered|already exists|email.*exists/i.test(raw)) {
    return "Cet email est déjà utilisé.";
  }
  if (/invalid.*email|email.*invalid/i.test(raw)) return "L’adresse email n’est pas valide.";
  if (/password/i.test(raw) && /least|weak|short|characters/i.test(raw)) {
    return "Le mot de passe doit faire au moins 8 caractères.";
  }
  if (/Forbidden|not allowed/i.test(raw)) return "Cette action est réservée à l’administrateur.";
  if (/User not found|introuvable/i.test(raw)) return "Ce membre est introuvable.";
  if (/banned/i.test(raw)) return "Impossible de modifier un compte bloqué pour le moment.";
  return /[àâéèêëîïôùûç]/i.test(raw) ? raw : fallback;
}

async function findAuthUserByEmail(supabaseAdmin: any, email: string) {
  const needle = email.trim().toLowerCase();
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return ((data?.users ?? []) as { id: string; email?: string | null }[]).find(
    (u) => (u.email ?? "").toLowerCase() === needle,
  ) ?? null;
}

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows ?? []) {
      const list = rolesByUser.get(row.user_id) ?? [];
      list.push(row.role);
      rolesByUser.set(row.user_id, list);
    }
    const staffIds = [...rolesByUser.entries()]
      .filter(([, roles]) => roles.includes("admin") || roles.includes("manager"))
      .map(([id]) => id);
    if (staffIds.length === 0) return [];

    const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const users = (usersPage?.users ?? []).filter((u) => staffIds.includes(u.id));
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", staffIds);
    const ids = staffIds;
    const { data: logs } = ids.length
      ? await supabaseAdmin
          .from("activity_logs")
          .select("actor_id, action, created_at")
          .in("actor_id", ids)
          .order("created_at", { ascending: false })
          .limit(400)
      : { data: [] as { actor_id: string | null; action: string; created_at: string }[] };

    const profileName = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    const profileAvatar = new Map((profiles ?? []).map((p) => [p.id, p.avatar_url]));
    return users.map((u) => {
      const memberLogs = (logs ?? []).filter((l) => l.actor_id === u.id);
      const lastSignInLog = memberLogs.find((l) => l.action === "user.signin");
      const bannedUntil = (u as { banned_until?: string | null }).banned_until ?? null;
      const banned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
      const metaName = typeof u.user_metadata?.full_name === "string" ? u.user_metadata.full_name : null;
      return {
        id: u.id,
        email: u.email,
        full_name: profileName.get(u.id) || metaName,
        avatar_url: profileAvatar.get(u.id) ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? lastSignInLog?.created_at ?? null,
        banned,
        banned_until: bannedUntil,
        action_count: memberLogs.filter((l) => l.action !== "user.signin").length,
        roles: rolesByUser.get(u.id) ?? [],
      };
    });
  });

const createManagerSchema = z.object({
  email: z.string().email("L’adresse email n’est pas valide."),
  password: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères.").max(128),
  full_name: z.string().min(1, "Indique le nom du manager.").max(120),
});

export const createManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const parsed = createManagerSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Informations invalides.");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    const { data: adminProfile } = await supabaseAdmin
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .maybeSingle();
    const workspaceId = adminProfile?.workspace_id ?? null;

    async function attachToWorkspace(userId: string) {
      if (!workspaceId) return;
      const payload = { id: userId, full_name: data.full_name, workspace_id: workspaceId };
      const { error: upErr } = await supabaseAdmin.from("profiles").upsert(payload, { onConflict: "id" });
      if (upErr) {
        const { error: updErr } = await supabaseAdmin
          .from("profiles")
          .update({ workspace_id: workspaceId, full_name: data.full_name })
          .eq("id", userId);
        if (updErr) throw new Error(teamError(updErr, "Impossible de rattacher ce manager à ton espace."));
      }
    }

    async function finish(userId: string, restored: boolean) {
      await attachToWorkspace(userId);
      const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
      const list = (roles ?? []).map((r: { role: string }) => r.role);
      if (list.includes("admin")) throw new Error("Cet email appartient déjà à un administrateur.");
      if (!list.includes("manager")) {
        const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "manager" });
        if (roleErr && !/duplicate|unique/i.test(roleErr.message)) throw new Error(teamError(roleErr, "Impossible d’attribuer le rôle manager."));
      }
      await supabaseAdmin.from("activity_logs").insert({
        action: "team.manager_created",
        actor_id: context.userId,
        actor_email: typeof context.claims.email === "string" ? context.claims.email : null,
        entity_type: "profiles",
        entity_id: userId,
        metadata: { label: data.full_name, email, restored },
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      });
      return { ok: true as const, id: userId, restored };
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });

    if (!error && created?.user) {
      return finish(created.user.id, false);
    }

    if (error && /already been registered|already registered|already exists/i.test(error.message)) {
      const existing = await findAuthUserByEmail(supabaseAdmin, email);
      if (!existing) throw new Error("Cet email est déjà utilisé.");

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("workspace_id")
        .eq("id", existing.id)
        .maybeSingle();

      const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", existing.id);
      const list = (roles ?? []).map((r: { role: string }) => r.role);
      if (list.includes("admin")) throw new Error("Cet email appartient déjà à un administrateur.");
      if (list.includes("manager") && profile?.workspace_id === workspaceId) {
        throw new Error("Ce manager est déjà dans l’équipe. Tu peux rétablir son accès depuis la liste s’il est bloqué.");
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: data.password,
        email_confirm: true,
        ban_duration: "none",
        user_metadata: { full_name: data.full_name },
      });
      if (updErr) throw new Error(teamError(updErr, "Impossible de mettre à jour ce compte."));
      return finish(existing.id, true);
    }

    throw new Error(teamError(error, "Création impossible. Réessaie dans un instant."));
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
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    await supabaseAdmin.from("activity_logs").insert({
      action: "team.member_deleted",
      actor_id: context.userId,
      actor_email: String(context.claims.email ?? ""),
      entity_type: "profiles",
      entity_id: data.user_id,
      metadata: { label: target.user?.email ?? data.user_id },
    });
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(teamError(error, "Impossible de retirer cet accès."));
    return { ok: true };
  });

export const setManagerAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), blocked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Impossible de bloquer votre propre compte");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    if ((roles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Un administrateur ne peut pas être bloqué");
    }
    const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    if (getErr || !target.user) throw new Error(getErr ? teamError(getErr, "Membre introuvable.") : "Membre introuvable.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.blocked ? "876000h" : "none",
    });
    if (error) throw new Error(teamError(error, "Impossible de modifier l’accès."));
    if (data.blocked) {
      await supabaseAdmin.auth.admin.signOut(data.user_id, "global").catch(() => {});
    }
    await supabaseAdmin.from("activity_logs").insert({
      action: data.blocked ? "team.access_blocked" : "team.access_restored",
      actor_id: context.userId,
      actor_email: String(context.claims.email ?? ""),
      entity_type: "profiles",
      entity_id: data.user_id,
      metadata: { label: target.user.email ?? data.user_id },
    });
    return { ok: true as const, blocked: data.blocked };
  });

export const listMemberActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("activity_logs")
      .select("id, action, actor_email, actor_id, entity_type, entity_id, metadata, created_at")
      .eq("actor_id", data.user_id)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(teamError(error, "Impossible de charger l’activité."));
    return rows ?? [];
  });
