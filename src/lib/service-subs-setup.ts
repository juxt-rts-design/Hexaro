export const SERVICE_SUBSCRIPTIONS_SQL = `-- Coller dans le SQL Editor Supabase, puis Exécuter.
-- Recharge ensuite la page Hexaro.

CREATE TABLE IF NOT EXISTS public.service_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  phone text,
  account_email text,
  account_password text,
  start_date timestamptz NOT NULL DEFAULT now(),
  duration_days integer NOT NULL DEFAULT 30,
  price numeric(12,2) NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  notes text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_subscriptions TO authenticated;
GRANT ALL ON public.service_subscriptions TO service_role;
ALTER TABLE public.service_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS service_subs_ws_idx ON public.service_subscriptions (workspace_id);
CREATE INDEX IF NOT EXISTS service_subs_service_idx ON public.service_subscriptions (service_id);

DROP POLICY IF EXISTS "ssub_ws_all" ON public.service_subscriptions;
CREATE POLICY "ssub_ws_all" ON public.service_subscriptions FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP TRIGGER IF EXISTS trg_ssub_workspace ON public.service_subscriptions;
CREATE TRIGGER trg_ssub_workspace BEFORE INSERT ON public.service_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();

DROP TRIGGER IF EXISTS trg_ssub_updated_at ON public.service_subscriptions;
CREATE TRIGGER trg_ssub_updated_at BEFORE UPDATE ON public.service_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ssub_expires ON public.service_subscriptions;
CREATE TRIGGER trg_ssub_expires BEFORE INSERT OR UPDATE OF start_date, duration_days ON public.service_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at();

NOTIFY pgrst, 'reload schema';
`;

export function isMissingTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /schema cache|does not exist|PGRST205|Could not find the table/i.test(msg);
}
