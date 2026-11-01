ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS owner_whatsapp text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weekly_report_sent_at timestamptz;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
