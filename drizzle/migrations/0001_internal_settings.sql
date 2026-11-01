CREATE TABLE IF NOT EXISTS public.internal_settings (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON public.internal_settings FROM anon, authenticated;
GRANT ALL ON public.internal_settings TO service_role;
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.internal_settings (key, value)
VALUES ('weekly_report_token', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;
