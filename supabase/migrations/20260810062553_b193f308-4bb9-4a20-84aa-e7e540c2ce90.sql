-- 1) Moyens de paiement + liaison paiement <-> abonnement
CREATE TYPE public.payment_method AS ENUM ('especes','airtel_money','moov_money','virement','autre');

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS method public.payment_method NOT NULL DEFAULT 'especes',
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'nouveau',
  ADD COLUMN IF NOT EXISTS subscription_id uuid,
  ADD COLUMN IF NOT EXISTS subscription_type text,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON public.payments (paid_at DESC);
CREATE INDEX IF NOT EXISTS payments_subscription_idx ON public.payments (subscription_type, subscription_id);

-- Historique financier immuable : plus de suppression de paiements (on annule via voided_at)
DROP POLICY IF EXISTS pay_admin_delete ON public.payments;
REVOKE DELETE ON public.payments FROM authenticated;

-- 2) expires_at calculé automatiquement sur les abonnements
ALTER TABLE public.netflix_profiles ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.spotify_members ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.internet_subscriptions ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.expires_at := COALESCE(NEW.start_date, now()) + make_interval(days => COALESCE(NEW.duration_days, 30));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfp_expires ON public.netflix_profiles;
CREATE TRIGGER trg_nfp_expires BEFORE INSERT OR UPDATE OF start_date, duration_days ON public.netflix_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at();
DROP TRIGGER IF EXISTS trg_spm_expires ON public.spotify_members;
CREATE TRIGGER trg_spm_expires BEFORE INSERT OR UPDATE OF start_date, duration_days ON public.spotify_members
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at();
DROP TRIGGER IF EXISTS trg_isub_expires ON public.internet_subscriptions;
CREATE TRIGGER trg_isub_expires BEFORE INSERT OR UPDATE OF start_date, duration_days ON public.internet_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at();

UPDATE public.netflix_profiles SET expires_at = COALESCE(start_date, created_at) + make_interval(days => duration_days) WHERE expires_at IS NULL;
UPDATE public.spotify_members SET expires_at = COALESCE(start_date, created_at) + make_interval(days => duration_days) WHERE expires_at IS NULL;
UPDATE public.internet_subscriptions SET expires_at = COALESCE(start_date, created_at) + make_interval(days => duration_days) WHERE expires_at IS NULL;

-- 3) Sécurité : les mots de passe des comptes Netflix/Spotify ne sont plus lisibles par le Data API
REVOKE SELECT ON public.netflix_accounts FROM authenticated;
GRANT SELECT (id, email, profiles_capacity, created_on, expires_on, status, notes, created_at, updated_at)
  ON public.netflix_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.netflix_accounts TO authenticated;
GRANT ALL ON public.netflix_accounts TO service_role;

REVOKE SELECT ON public.spotify_accounts FROM authenticated;
GRANT SELECT (id, email, seats, status, notes, created_at, updated_at)
  ON public.spotify_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.spotify_accounts TO authenticated;
GRANT ALL ON public.spotify_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.get_account_password(_service text, _id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE pw text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

REVOKE ALL ON FUNCTION public.get_account_password(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_password(text, uuid) TO authenticated;