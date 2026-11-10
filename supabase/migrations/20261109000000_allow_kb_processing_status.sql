-- The document worker atomically claims pending documents as processing.
-- Keep the state constraint aligned without rewriting applied migration history.
ALTER TABLE public.kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_status_check;
ALTER TABLE public.kb_documents
  ADD CONSTRAINT kb_documents_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'failed'));
