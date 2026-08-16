import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type Role = "admin" | "manager";

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: Role[];
  workspaceId: string | null;
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
};

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadExtras = async (uid: string | undefined) => {
      if (!uid) {
        if (mounted) {
          setRoles([]);
          setWorkspaceId(null);
        }
        return;
      }
      const [{ data: roleRows }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("workspace_id").eq("id", uid).maybeSingle(),
      ]);
      if (!mounted) return;
      setRoles((roleRows ?? []).map((r: { role: string }) => r.role as Role));
      setWorkspaceId((profile as { workspace_id?: string | null } | null)?.workspace_id ?? null);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      if (event === "TOKEN_REFRESHED") {
        setSession(s);
        return;
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        setTimeout(() => loadExtras(s?.user?.id), 0);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      loadExtras(data.session?.user?.id).finally(() => mounted && setLoading(false));
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  return {
    loading,
    session,
    user,
    roles,
    workspaceId,
    isAdmin,
    isManager,
    isStaff: isAdmin || isManager,
  };
}

export function myProfileQueryKey(userId?: string | null) {
  return ["my-profile", userId ?? "anon"] as const;
}

export function useMyProfile() {
  const { user, loading } = useAuth();
  const query = useQuery({
    queryKey: myProfileQueryKey(user?.id),
    enabled: Boolean(user?.id) && !loading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, phone, bio")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  return { ...query, user };
}
