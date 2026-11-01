ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS status_message text;
DO $$ BEGIN
  ALTER TABLE public.kb_documents ADD CONSTRAINT kb_documents_status_check CHECK (status IN ('pending','processed','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
