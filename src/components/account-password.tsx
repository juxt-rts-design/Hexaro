import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Le mot de passe n'est jamais chargé avec le compte : il est révélé à la demande
 * via une RPC qui ne le renvoie que pour l'espace courant.
 */
export function AccountPassword({ service, accountId }: { service: "netflix" | "spotify" | "service"; accountId: string }) {
  const [pw, setPw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    if (pw) { setPw(null); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_account_password", { _service: service, _id: accountId });
    setLoading(false);
    if (error) { toast.error("Accès refusé"); return; }
    setPw(data ?? "—");
  }

  return (
    <button type="button" onClick={reveal} className="flex items-center gap-1 hover:text-foreground">
      {pw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      {loading ? "…" : pw ?? "••••••••"}
    </button>
  );
}
