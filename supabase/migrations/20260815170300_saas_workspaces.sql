-- SaaS : un espace de travail par compte (Google ou inscription).
-- L'équipe Hexaro existante partage le même espace (données actuelles conservées).

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Mon espace',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces_select_own" ON public.workspaces FOR SELECT TO authenticated
  USING (id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspace_match(_ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _ws IS NOT NULL AND _ws = public.current_workspace_id();
$$;
REVOKE ALL ON FUNCTION public.workspace_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_match(uuid) TO authenticated, service_role;

-- Espace Hexaro (données déjà importées)
INSERT INTO public.workspaces (id, owner_id, name)
VALUES (
  'a1111111-1111-4111-8111-111111111111',
  '89a6c25a-264c-460d-ae0b-3809705e2f36',
  'Hexaro'
)
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles
SET workspace_id = 'a1111111-1111-4111-8111-111111111111'
WHERE id IN (
  '89a6c25a-264c-460d-ae0b-3809705e2f36',
  'acc2d9a8-3baa-4a59-a059-f485c321b4f1'
)
AND workspace_id IS NULL;

-- Autres comptes déjà présents : chacun son espace
DO $$
DECLARE r record;
  ws uuid;
BEGIN
  FOR r IN SELECT id, full_name FROM public.profiles WHERE workspace_id IS NULL LOOP
    INSERT INTO public.workspaces (owner_id, name)
    VALUES (r.id, COALESCE(r.full_name, 'Mon espace'))
    RETURNING id INTO ws;
    UPDATE public.profiles SET workspace_id = ws WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ws_id uuid;
BEGIN
  INSERT INTO public.workspaces (owner_id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Mon espace')
  )
  RETURNING id INTO ws_id;

  INSERT INTO public.profiles (id, full_name, workspace_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    ws_id
  )
  ON CONFLICT (id) DO UPDATE
    SET workspace_id = COALESCE(public.profiles.workspace_id, EXCLUDED.workspace_id),
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := public.current_workspace_id();
  END IF;
  RETURN NEW;
END;
$$;

-- Colonnes tenant
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.netflix_accounts ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.netflix_profiles ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.spotify_accounts ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.spotify_members ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.internet_subscriptions ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.clients SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.netflix_accounts SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.netflix_profiles SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.spotify_accounts SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.spotify_members SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.internet_subscriptions SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.payments SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;
UPDATE public.activity_logs SET workspace_id = 'a1111111-1111-4111-8111-111111111111' WHERE workspace_id IS NULL;

ALTER TABLE public.clients ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.netflix_accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.netflix_profiles ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.spotify_accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.spotify_members ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.internet_subscriptions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.activity_logs ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS clients_workspace_idx ON public.clients (workspace_id);
CREATE INDEX IF NOT EXISTS nfa_workspace_idx ON public.netflix_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS nfp_workspace_idx ON public.netflix_profiles (workspace_id);
CREATE INDEX IF NOT EXISTS spa_workspace_idx ON public.spotify_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS spm_workspace_idx ON public.spotify_members (workspace_id);
CREATE INDEX IF NOT EXISTS isub_workspace_idx ON public.internet_subscriptions (workspace_id);
CREATE INDEX IF NOT EXISTS pay_workspace_idx ON public.payments (workspace_id);
CREATE INDEX IF NOT EXISTS logs_workspace_idx ON public.activity_logs (workspace_id);

DROP TRIGGER IF EXISTS trg_clients_workspace ON public.clients;
CREATE TRIGGER trg_clients_workspace BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_nfa_workspace ON public.netflix_accounts;
CREATE TRIGGER trg_nfa_workspace BEFORE INSERT ON public.netflix_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_nfp_workspace ON public.netflix_profiles;
CREATE TRIGGER trg_nfp_workspace BEFORE INSERT ON public.netflix_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_spa_workspace ON public.spotify_accounts;
CREATE TRIGGER trg_spa_workspace BEFORE INSERT ON public.spotify_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_spm_workspace ON public.spotify_members;
CREATE TRIGGER trg_spm_workspace BEFORE INSERT ON public.spotify_members
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_isub_workspace ON public.internet_subscriptions;
CREATE TRIGGER trg_isub_workspace BEFORE INSERT ON public.internet_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_pay_workspace ON public.payments;
CREATE TRIGGER trg_pay_workspace BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_logs_workspace ON public.activity_logs;
CREATE TRIGGER trg_logs_workspace BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();
DROP TRIGGER IF EXISTS trg_services_workspace ON public.services;
CREATE TRIGGER trg_services_workspace BEFORE INSERT ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_id();

-- RLS métier : isolation par espace
DROP POLICY IF EXISTS "clients_staff_read" ON public.clients;
DROP POLICY IF EXISTS "clients_staff_write" ON public.clients;
DROP POLICY IF EXISTS "clients_staff_update" ON public.clients;
DROP POLICY IF EXISTS "clients_admin_delete" ON public.clients;
CREATE POLICY "clients_ws_all" ON public.clients FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "nfa_staff_read" ON public.netflix_accounts;
DROP POLICY IF EXISTS "nfa_staff_write" ON public.netflix_accounts;
DROP POLICY IF EXISTS "nfa_staff_update" ON public.netflix_accounts;
DROP POLICY IF EXISTS "nfa_admin_delete" ON public.netflix_accounts;
CREATE POLICY "nfa_ws_all" ON public.netflix_accounts FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "nfp_staff_all" ON public.netflix_profiles;
CREATE POLICY "nfp_ws_all" ON public.netflix_profiles FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "spa_staff_all" ON public.spotify_accounts;
DROP POLICY IF EXISTS "spa_admin_delete" ON public.spotify_accounts;
CREATE POLICY "spa_ws_all" ON public.spotify_accounts FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "spm_staff_all" ON public.spotify_members;
CREATE POLICY "spm_ws_all" ON public.spotify_members FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "isub_staff_all" ON public.internet_subscriptions;
CREATE POLICY "isub_ws_all" ON public.internet_subscriptions FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "pay_staff_read" ON public.payments;
DROP POLICY IF EXISTS "pay_staff_insert" ON public.payments;
DROP POLICY IF EXISTS "pay_admin_modify" ON public.payments;
DROP POLICY IF EXISTS "pay_admin_delete" ON public.payments;
CREATE POLICY "pay_ws_select" ON public.payments FOR SELECT TO authenticated
  USING (public.workspace_match(workspace_id));
CREATE POLICY "pay_ws_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.workspace_match(workspace_id));
CREATE POLICY "pay_ws_update" ON public.payments FOR UPDATE TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "logs_staff_read" ON public.activity_logs;
DROP POLICY IF EXISTS "logs_staff_insert" ON public.activity_logs;
CREATE POLICY "logs_ws_all" ON public.activity_logs FOR ALL TO authenticated
  USING (public.workspace_match(workspace_id)) WITH CHECK (public.workspace_match(workspace_id));

DROP POLICY IF EXISTS "forfait_staff_all" ON public.internet_forfaits;
CREATE POLICY "forfait_read_authed" ON public.internet_forfaits FOR SELECT TO authenticated USING (true);
CREATE POLICY "forfait_staff_write" ON public.internet_forfaits FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Services : catalogue intégré partagé + services perso par espace
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_name_key;
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS services_builtin_slug ON public.services (slug) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS services_ws_slug ON public.services (workspace_id, slug) WHERE workspace_id IS NOT NULL;

DROP POLICY IF EXISTS "services_staff_read" ON public.services;
DROP POLICY IF EXISTS "services_admin_write" ON public.services;
CREATE POLICY "services_read" ON public.services FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.workspace_match(workspace_id));
CREATE POLICY "services_insert_own" ON public.services FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.workspace_match(workspace_id) AND is_builtin = false);
CREATE POLICY "services_delete_own" ON public.services FOR DELETE TO authenticated
  USING (workspace_id IS NOT NULL AND public.workspace_match(workspace_id) AND is_builtin = false);

DROP POLICY IF EXISTS "profiles_select_authed" ON public.profiles;
CREATE POLICY "profiles_select_own_or_ws" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR workspace_id = public.current_workspace_id());

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, bio, settings, updated_at) ON public.profiles TO authenticated;

-- Mots de passe des comptes : propriétaire de l'espace, plus seulement admin plateforme
CREATE OR REPLACE FUNCTION public.get_account_password(_service text, _id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE pw text;
BEGIN
  IF _service = 'netflix' THEN
    SELECT password INTO pw FROM public.netflix_accounts
    WHERE id = _id AND workspace_id = public.current_workspace_id();
  ELSIF _service = 'spotify' THEN
    SELECT password INTO pw FROM public.spotify_accounts
    WHERE id = _id AND workspace_id = public.current_workspace_id();
  ELSE
    RAISE EXCEPTION 'Service inconnu';
  END IF;
  IF pw IS NULL THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  RETURN pw;
END;
$$;

-- Médias : {workspace_id}/dossier/fichier — l'espace Hexaro garde aussi affiches/ à la racine
DROP POLICY IF EXISTS "Staff can view media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete media" ON storage.objects;

CREATE POLICY "media_select_ws" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = public.current_workspace_id()::text
      OR (
        public.current_workspace_id() = 'a1111111-1111-4111-8111-111111111111'
        AND (storage.foldername(name))[1] IN ('affiches', 'videos', 'fiches', 'documents')
      )
    )
  );
CREATE POLICY "media_insert_ws" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = public.current_workspace_id()::text
      OR (
        public.current_workspace_id() = 'a1111111-1111-4111-8111-111111111111'
        AND (storage.foldername(name))[1] IN ('affiches', 'videos', 'fiches', 'documents')
      )
    )
  );
CREATE POLICY "media_update_ws" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = public.current_workspace_id()::text
      OR (
        public.current_workspace_id() = 'a1111111-1111-4111-8111-111111111111'
        AND (storage.foldername(name))[1] IN ('affiches', 'videos', 'fiches', 'documents')
      )
    )
  );
CREATE POLICY "media_delete_ws" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = public.current_workspace_id()::text
      OR (
        public.current_workspace_id() = 'a1111111-1111-4111-8111-111111111111'
        AND (storage.foldername(name))[1] IN ('affiches', 'videos', 'fiches', 'documents')
      )
    )
  );
