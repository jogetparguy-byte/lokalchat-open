-- Supabase commonly installs pgvector in the trusted extensions schema.
-- Keep vector operators available in the tenant-scoped search function.
ALTER FUNCTION public.match_documents(vector, uuid, double precision, integer)
  SET search_path = public, extensions, pg_temp;
