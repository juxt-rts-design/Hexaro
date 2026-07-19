
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX notifications_broadcast_idx ON public.notifications(created_at DESC) WHERE recipient_id IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users see their own notifications; admins see broadcasts too
CREATE POLICY "read own or broadcast to admins" ON public.notifications FOR SELECT TO authenticated
USING (
  recipient_id = auth.uid()
  OR (recipient_id IS NULL AND public.has_role(auth.uid(), 'admin'))
);

-- Users can mark their notifications as read
CREATE POLICY "update own read" ON public.notifications FOR UPDATE TO authenticated
USING (
  recipient_id = auth.uid()
  OR (recipient_id IS NULL AND public.has_role(auth.uid(), 'admin'))
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Trigger: notify admins on new user in auth.users
CREATE OR REPLACE FUNCTION public.notify_admins_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, type, title, body, meta)
  VALUES (
    NULL,
    'user.created',
    'Nouvel utilisateur créé',
    COALESCE(NEW.email, 'Utilisateur') || ' a rejoint la plateforme',
    jsonb_build_object('user_id', NEW.id, 'email', NEW.email)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_notify ON auth.users;
CREATE TRIGGER on_auth_user_created_notify
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_user();

-- Add profile fields for personal info if not present (avatar_url, phone already exist)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow users to update their own profile
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());
