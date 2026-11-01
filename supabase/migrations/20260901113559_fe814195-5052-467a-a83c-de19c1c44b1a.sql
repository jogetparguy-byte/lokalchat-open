ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS system_prompt text;

CREATE TABLE IF NOT EXISTS public.kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_documents TO authenticated;
GRANT ALL ON public.kb_documents TO service_role;

ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Businesses manage own kb documents"
ON public.kb_documents FOR ALL TO authenticated
USING (business_id = auth.uid())
WITH CHECK (business_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_kb_documents_business_id ON public.kb_documents(business_id);

CREATE TRIGGER kb_documents_updated_at
BEFORE UPDATE ON public.kb_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
