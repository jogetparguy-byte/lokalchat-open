REVOKE ALL ON FUNCTION public.match_documents(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_documents(vector, uuid, double precision, integer) TO service_role;
