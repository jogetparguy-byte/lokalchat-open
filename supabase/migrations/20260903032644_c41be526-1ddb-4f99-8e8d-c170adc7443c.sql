ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS display_phone_number text,
  ADD COLUMN IF NOT EXISTS access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS app_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_message text;

ALTER TABLE public.whatsapp_connections ALTER COLUMN verify_token SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_connections_business_id_key') THEN
    ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_business_id_key UNIQUE (business_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_connections_phone_number_id_key') THEN
    ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_phone_number_id_key UNIQUE (phone_number_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_connections_verify_token_key') THEN
    ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_verify_token_key UNIQUE (verify_token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_connections_status_check') THEN
    ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_status_check
      CHECK (connection_status IN ('pending','connected','invalid','disconnected'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Businesses manage own whatsapp connection" ON public.whatsapp_connections;
CREATE POLICY "Businesses read own whatsapp connection"
  ON public.whatsapp_connections FOR SELECT TO authenticated
  USING (business_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.whatsapp_connections FROM authenticated;
GRANT SELECT ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;
