import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { HexaroShell } from "@/components/hexaro-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  shouldReload: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });
    const { data: staff } = await supabase.rpc("is_staff", { _user_id: user.id });
    if (!staff) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      throw redirect({ to: "/auth" });
    }
    return { user };
  },
  component: LayoutRoute,
});

function LayoutRoute() {
  return (
    <HexaroShell>
      <Outlet />
    </HexaroShell>
  );
}
