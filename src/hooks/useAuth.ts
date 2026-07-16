import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type Role = "admin" | "manager";

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: Role[];
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
};

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadRoles = async (uid: string | undefined) => {
      if (!uid) {
        if (mounted) setRoles([]);
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      if (mounted) setRoles((data ?? []).map((r: any) => r.role as Role));
    };

    // 1. subscribe first (synchronous)
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        // defer role loading
        setTimeout(() => loadRoles(s?.user?.id), 0);
      }
    });

    // 2. then get session
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      loadRoles(data.session?.user?.id).finally(() => mounted && setLoading(false));
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
    isAdmin,
    isManager,
    isStaff: isAdmin || isManager,
  };
}
