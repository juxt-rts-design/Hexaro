-- Droits manager : lecture/écriture opérationnelle, historique financier protégé,
-- journal d'activité automatique, mots de passe comptes pour le staff.

CREATE OR REPLACE FUNCTION public.get_account_password(_service text, _id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE pw text;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  IF _service = 'netflix' THEN
    SELECT password INTO pw FROM public.netflix_accounts WHERE id = _id;
  ELSIF _service = 'spotify' THEN
    SELECT password INTO pw FROM public.spotify_accounts WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'Service inconnu';
  END IF;
  RETURN pw;
END;
$$;

DROP POLICY IF EXISTS "pay_admin_modify" ON public.payments;
DROP POLICY IF EXISTS "pay_admin_update" ON public.payments;
DROP POLICY IF EXISTS "pay_manager_update_own" ON public.payments;

CREATE POLICY "pay_admin_update" ON public.payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "pay_manager_update_own" ON public.payments FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager')
    AND created_by = auth.uid()
    AND voided_at IS NULL
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager')
    AND created_by = auth.uid()
    AND voided_at IS NULL
  );

DROP POLICY IF EXISTS "logs_ws_all" ON public.activity_logs;
DROP POLICY IF EXISTS "logs_staff_read" ON public.activity_logs;
DROP POLICY IF EXISTS "logs_staff_insert" ON public.activity_logs;
DROP POLICY IF EXISTS "logs_admin_read" ON public.activity_logs;
DROP POLICY IF EXISTS "logs_own_read" ON public.activity_logs;

CREATE POLICY "logs_admin_read" ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "logs_own_read" ON public.activity_logs FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

CREATE POLICY "logs_staff_insert" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND (actor_id IS NULL OR actor_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.log_data_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  mail text;
  payload jsonb;
  rid uuid;
  verb text;
  rowdata jsonb;
BEGIN
  IF actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT u.email INTO mail FROM auth.users u WHERE u.id = actor;

  IF TG_OP = 'DELETE' THEN
    rowdata := to_jsonb(OLD);
    rid := OLD.id;
    verb := 'delete';
  ELSE
    rowdata := to_jsonb(NEW);
    rid := NEW.id;
    verb := lower(TG_OP);
  END IF;

  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'payments'
     AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    verb := 'void';
  END IF;

  rowdata := rowdata - 'password' - 'account_password' - 'pin' - 'updated_at';

  payload := jsonb_strip_nulls(jsonb_build_object(
    'op', verb,
    'label', COALESCE(
      rowdata->>'profile_name',
      rowdata->>'member_name',
      rowdata->>'client_name',
      rowdata->>'email',
      rowdata->>'name'
    ),
    'price', rowdata->'price',
    'amount', rowdata->'amount',
    'service_slug', rowdata->>'service_slug',
    'kind', rowdata->>'kind'
  ));

  IF EXISTS (
    SELECT 1 FROM public.activity_logs
    WHERE actor_id = actor
      AND entity_id = rid
      AND action = TG_TABLE_NAME || '.' || verb
      AND created_at > now() - interval '3 seconds'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.activity_logs (action, actor_id, actor_email, entity_type, entity_id, metadata)
  VALUES (TG_TABLE_NAME || '.' || verb, actor, mail, TG_TABLE_NAME, rid, payload);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_nfp ON public.netflix_profiles;
CREATE TRIGGER trg_log_nfp AFTER INSERT OR UPDATE OR DELETE ON public.netflix_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_nfa ON public.netflix_accounts;
CREATE TRIGGER trg_log_nfa AFTER INSERT OR UPDATE OR DELETE ON public.netflix_accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_spm ON public.spotify_members;
CREATE TRIGGER trg_log_spm AFTER INSERT OR UPDATE OR DELETE ON public.spotify_members
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_spa ON public.spotify_accounts;
CREATE TRIGGER trg_log_spa AFTER INSERT OR UPDATE OR DELETE ON public.spotify_accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_isub ON public.internet_subscriptions;
CREATE TRIGGER trg_log_isub AFTER INSERT OR UPDATE OR DELETE ON public.internet_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_pay ON public.payments;
CREATE TRIGGER trg_log_pay AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DROP TRIGGER IF EXISTS trg_log_svc ON public.services;
CREATE TRIGGER trg_log_svc AFTER INSERT OR UPDATE OR DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.log_data_change();

DO $$
BEGIN
  IF to_regclass('public.service_subscriptions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_log_ssub ON public.service_subscriptions;
    CREATE TRIGGER trg_log_ssub AFTER INSERT OR UPDATE OR DELETE ON public.service_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.log_data_change();
  END IF;
END $$;
