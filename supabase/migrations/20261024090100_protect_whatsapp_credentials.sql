-- Protect WhatsApp tenant credentials from the PostgREST API.
--
-- The table previously granted table-wide SELECT to `authenticated`. RLS
-- limited rows to the owner, but the owner could still read every column,
-- including:
--   * verify_token          (webhook handshake secret)
--   * access_token          (legacy plaintext token, if populated)
--   * access_token_encrypted
--   * app_secret_encrypted
--
-- Replace the table-wide grant with column-level SELECT grants for the safe
-- metadata used by the dashboard. The existing RLS policy is left intact and
-- remains the row-level gate; this migration only narrows columns.
--
-- Service-role access is unchanged (the backend/webhook uses service_role to
-- read and decrypt credentials).

-- Make sure RLS is actually enforced. The policy already existed, but enabling
-- RLS here is idempotent and guarantees the policy is effective even if the
-- table was created outside the checked-in migrations without RLS.
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_connections FROM anon;
REVOKE ALL ON public.whatsapp_connections FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.whatsapp_connections FROM authenticated;
REVOKE SELECT ON public.whatsapp_connections FROM authenticated;

-- Safe, non-secret columns required by:
--   src/lib/lokalchat.functions.ts  -> getWhatsappConnection()
--   src/lib/lokalchat.functions.ts  -> getSetupChecklist()
GRANT SELECT (
  business_id,
  phone_number_id,
  display_phone_number,
  waba_id,
  connection_status,
  last_verified_at,
  last_error_message,
  created_at,
  updated_at
) ON public.whatsapp_connections TO authenticated;

GRANT ALL ON public.whatsapp_connections TO service_role;

-- Ask PostgREST to reload its schema/privilege cache so the narrowed grants
-- take effect immediately. This is safe on plain PostgreSQL as well.
NOTIFY pgrst, 'reload schema';
