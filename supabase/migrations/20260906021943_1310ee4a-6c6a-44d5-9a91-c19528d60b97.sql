ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'sme';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('sme', 'admin'));

UPDATE public.profiles p
SET role = 'admin'
FROM auth.users u
WHERE u.id = p.id AND lower(u.email) = 'REPLACE_ME_ADMIN_EMAIL';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read all chats" ON public.chats;
CREATE POLICY "Admins read all chats" ON public.chats
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read all messages" ON public.messages;
CREATE POLICY "Admins read all messages" ON public.messages
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read all handoff events" ON public.handoff_events;
CREATE POLICY "Admins read all handoff events" ON public.handoff_events
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.platform_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  api_key_encrypted text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_api_keys_provider_key
  ON public.platform_api_keys (provider);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_api_keys TO authenticated;
GRANT ALL ON public.platform_api_keys TO service_role;

ALTER TABLE public.platform_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage platform api keys" ON public.platform_api_keys;
CREATE POLICY "Admins manage platform api keys" ON public.platform_api_keys
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS platform_api_keys_updated_at ON public.platform_api_keys;
CREATE TRIGGER platform_api_keys_updated_at
  BEFORE UPDATE ON public.platform_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
