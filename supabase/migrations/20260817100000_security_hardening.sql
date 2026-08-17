-- Durcissement : paiements, mots de passe comptes, staff-only.

DROP POLICY IF EXISTS "pay_ws_update" ON public.payments;

DROP POLICY IF EXISTS "pay_ws_insert" ON public.payments;
CREATE POLICY "pay_ws_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "pay_ws_select" ON public.payments;
CREATE POLICY "pay_ws_select" ON public.payments FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

CREATE OR REPLACE FUNCTION public.get_account_password(_service text, _id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE pw text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  IF _service = 'netflix' THEN
    SELECT password INTO pw FROM public.netflix_accounts
    WHERE id = _id AND workspace_id = public.current_workspace_id();
  ELSIF _service = 'spotify' THEN
    SELECT password INTO pw FROM public.spotify_accounts
    WHERE id = _id AND workspace_id = public.current_workspace_id();
  ELSIF _service = 'service' THEN
    SELECT account_password INTO pw FROM public.service_subscriptions
    WHERE id = _id AND workspace_id = public.current_workspace_id();
  ELSE
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  RETURN pw;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_password(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_password(text, uuid) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.service_subscriptions') IS NOT NULL THEN
    REVOKE SELECT (account_password) ON public.service_subscriptions FROM authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
