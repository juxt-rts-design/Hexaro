
-- ==========================
-- Enums & helpers
-- ==========================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager');
CREATE TYPE public.entity_status AS ENUM ('active', 'suspended', 'expired', 'pending');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ==========================
-- Profiles
-- ==========================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_authed" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto create profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================
-- Roles
-- ==========================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==========================
-- Staff-only helper policy generator: staff = any authenticated user with admin or manager role
-- ==========================
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'manager');
$$;

-- ==========================
-- Clients
-- ==========================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT,
  pseudo TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  photo_url TEXT,
  status public.entity_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_staff_read" ON public.clients FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "clients_staff_write" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "clients_staff_update" ON public.clients FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "clients_admin_delete" ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_clients_name ON public.clients (last_name, first_name);
CREATE INDEX idx_clients_phone ON public.clients (phone);

-- ==========================
-- Services (modules dynamiques)
-- ==========================
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  description TEXT,
  default_duration_days INTEGER NOT NULL DEFAULT 30,
  default_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  color TEXT,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services_staff_read" ON public.services FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "services_admin_write" ON public.services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.services (name, slug, description, default_duration_days, default_price, color, is_builtin) VALUES
  ('Netflix', 'netflix', 'Compte Netflix partagé par profil', 30, 3000, '#E50914', TRUE),
  ('Spotify', 'spotify', 'Spotify Family — jusqu''à 6 membres', 30, 2000, '#1DB954', TRUE),
  ('Internet Libertis', 'internet', 'Forfait Internet illimité SIM Libertis', 30, 5000, '#F97316', TRUE);

-- ==========================
-- Netflix
-- ==========================
CREATE TABLE public.netflix_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  profiles_capacity INTEGER NOT NULL DEFAULT 5,
  created_on DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_on DATE,
  status public.entity_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.netflix_accounts TO authenticated;
GRANT ALL ON public.netflix_accounts TO service_role;
ALTER TABLE public.netflix_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfa_staff_read" ON public.netflix_accounts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "nfa_staff_write" ON public.netflix_accounts FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "nfa_staff_update" ON public.netflix_accounts FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "nfa_admin_delete" ON public.netflix_accounts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_nfa_updated_at BEFORE UPDATE ON public.netflix_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.netflix_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.netflix_accounts(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  pin TEXT,
  pseudo TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  start_date TIMESTAMPTZ,
  duration_days INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.netflix_profiles TO authenticated;
GRANT ALL ON public.netflix_profiles TO service_role;
ALTER TABLE public.netflix_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfp_staff_all" ON public.netflix_profiles FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_nfp_updated_at BEFORE UPDATE ON public.netflix_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_nfp_account ON public.netflix_profiles(account_id);
CREATE INDEX idx_nfp_client ON public.netflix_profiles(client_id);

-- ==========================
-- Spotify
-- ==========================
CREATE TABLE public.spotify_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 6,
  status public.entity_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spotify_accounts TO authenticated;
GRANT ALL ON public.spotify_accounts TO service_role;
ALTER TABLE public.spotify_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spa_staff_all" ON public.spotify_accounts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "spa_admin_delete" ON public.spotify_accounts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_spa_updated_at BEFORE UPDATE ON public.spotify_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.spotify_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.spotify_accounts(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  pseudo TEXT,
  member_email TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  start_date TIMESTAMPTZ,
  duration_days INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spotify_members TO authenticated;
GRANT ALL ON public.spotify_members TO service_role;
ALTER TABLE public.spotify_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spm_staff_all" ON public.spotify_members FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_spm_updated_at BEFORE UPDATE ON public.spotify_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================
-- Internet
-- ==========================
CREATE TABLE public.internet_forfaits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internet_forfaits TO authenticated;
GRANT ALL ON public.internet_forfaits TO service_role;
ALTER TABLE public.internet_forfaits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "forfait_staff_all" ON public.internet_forfaits FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

INSERT INTO public.internet_forfaits (name, duration_days, price) VALUES
  ('3 jours', 3, 1000),
  ('7 jours', 7, 2000),
  ('30 jours', 30, 5000);

CREATE TABLE public.internet_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  phone TEXT,
  sim_card TEXT,
  sim_number TEXT,
  forfait_id UUID REFERENCES public.internet_forfaits(id),
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_days INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internet_subscriptions TO authenticated;
GRANT ALL ON public.internet_subscriptions TO service_role;
ALTER TABLE public.internet_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "isub_staff_all" ON public.internet_subscriptions FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_isub_updated_at BEFORE UPDATE ON public.internet_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================
-- Payments (revenus)
-- ==========================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_slug TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_staff_read" ON public.payments FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "pay_staff_insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "pay_admin_modify" ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pay_admin_delete" ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_payments_paid_at ON public.payments(paid_at DESC);

-- ==========================
-- Activity logs
-- ==========================
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs_staff_read" ON public.activity_logs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "logs_staff_insert" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_logs_created_at ON public.activity_logs(created_at DESC);
