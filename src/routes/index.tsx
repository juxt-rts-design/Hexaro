import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-brand animate-pulse" />
        Chargement de Hexaro…
      </div>
    </div>
  );
}
