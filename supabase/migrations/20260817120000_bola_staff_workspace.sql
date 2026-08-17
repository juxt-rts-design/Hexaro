-- Isolation tenant + staff-only (BOLA / IDOR).

DROP POLICY IF EXISTS "clients_ws_all" ON public.clients;
CREATE POLICY "clients_ws_staff" ON public.clients FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "nfa_ws_all" ON public.netflix_accounts;
CREATE POLICY "nfa_ws_staff" ON public.netflix_accounts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "nfp_ws_all" ON public.netflix_profiles;
CREATE POLICY "nfp_ws_staff" ON public.netflix_profiles FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "spa_ws_all" ON public.spotify_accounts;
CREATE POLICY "spa_ws_staff" ON public.spotify_accounts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "spm_ws_all" ON public.spotify_members;
CREATE POLICY "spm_ws_staff" ON public.spotify_members FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "isub_ws_all" ON public.internet_subscriptions;
CREATE POLICY "isub_ws_staff" ON public.internet_subscriptions FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "ssub_ws_all" ON public.service_subscriptions;
CREATE POLICY "ssub_ws_staff" ON public.service_subscriptions FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id))
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "pay_ws_update" ON public.payments;
DROP POLICY IF EXISTS "pay_ws_insert" ON public.payments;
DROP POLICY IF EXISTS "pay_ws_select" ON public.payments;
CREATE POLICY "pay_ws_select" ON public.payments FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));
CREATE POLICY "pay_ws_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "logs_admin_read" ON public.activity_logs;
CREATE POLICY "logs_admin_read" ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "roles_select_own_or_admin" ON public.user_roles;
CREATE POLICY "roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      public.has_role(auth.uid(), 'admin')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND p.workspace_id IS NOT NULL
          AND p.workspace_id = public.current_workspace_id()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
