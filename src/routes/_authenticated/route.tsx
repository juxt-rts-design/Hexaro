import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { HexaroShell } from "@/components/hexaro-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  shouldReload: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/auth" });
    return { user: data.session.user };
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
