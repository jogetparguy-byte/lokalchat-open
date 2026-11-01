-- Create the missing whatsapp_connections base table.
--
-- Several later migrations ALTER this table (20260903032644 and
-- 20260904021923), but the table was originally created outside the checked-in
-- migrations (dashboard/project setup). A fresh database therefore failed at
-- 20260903032644 with "relation public.whatsapp_connections does not exist".
--
-- This migration is intentionally idempotent and non-destructive:
--   * CREATE TABLE IF NOT EXISTS creates the table on fresh databases.
--   * ADD COLUMN IF NOT EXISTS reconciles older/partial tables without
--     dropping or rewriting existing rows.
--   * RLS is enabled, but policies are left to the existing later migrations.
--
-- It is placed before its dependants so a fresh `supabase db push` succeeds.
-- On an existing project the table already exists, so the CREATE is a no-op
-- and existing data is preserved.

CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  verify_token text NOT NULL,
  access_token text,
  access_token_encrypted text,
  app_secret_encrypted text,
  waba_id text,
  display_phone_number text,
  connection_status text NOT NULL DEFAULT 'pending',
  last_verified_at timestamptz,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reconcile a pre-existing/partial table without touching its data. Columns
-- that have a safe default (status/timestamps) are added as NOT NULL; identity
-- columns that cannot be backfilled are added nullable so the statement cannot
-- fail on existing rows. The later migrations add the unique/not-null
-- constraints they require.
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS business_id uuid,
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS verify_token text,
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS app_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS display_phone_number text,
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.whatsapp_connections IS
  'Per-tenant WhatsApp Cloud API connection. Credentials are encrypted; client roles only receive column-level SELECT on safe metadata columns.';
