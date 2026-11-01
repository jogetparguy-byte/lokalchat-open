ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.kb_documents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_document_id ON public.knowledge_base(document_id);

DROP POLICY IF EXISTS "Businesses can delete own knowledge base" ON public.knowledge_base;
CREATE POLICY "Businesses can delete own knowledge base" ON public.knowledge_base FOR DELETE TO authenticated USING (business_id = auth.uid());

DROP POLICY IF EXISTS "Businesses can delete own kb documents" ON public.kb_documents;
CREATE POLICY "Businesses can delete own kb documents" ON public.kb_documents FOR DELETE TO authenticated USING (business_id = auth.uid());

GRANT DELETE ON public.knowledge_base TO authenticated;
GRANT DELETE ON public.kb_documents TO authenticated;
