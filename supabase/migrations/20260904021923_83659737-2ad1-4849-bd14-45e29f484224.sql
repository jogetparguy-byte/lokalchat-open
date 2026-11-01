-- 1. Lock down SECURITY DEFINER trigger function from API roles
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_documents(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;

-- 2. whatsapp_connections: no anon access at all, tokens never client-readable
REVOKE ALL ON public.whatsapp_connections FROM anon;
REVOKE ALL ON public.whatsapp_connections FROM PUBLIC;
GRANT SELECT ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;
ALTER TABLE public.whatsapp_connections ALTER COLUMN business_id SET NOT NULL;
DROP POLICY IF EXISTS "Businesses read own whatsapp connection" ON public.whatsapp_connections;
CREATE POLICY "Businesses read own whatsapp connection"
  ON public.whatsapp_connections FOR SELECT TO authenticated
  USING (business_id = auth.uid());

-- 3. chats realtime PII: guarantee owner scoping can never be bypassed by NULL business_id
ALTER TABLE public.chats ALTER COLUMN business_id SET NOT NULL;
REVOKE ALL ON public.chats FROM anon;
DROP POLICY IF EXISTS "Businesses manage own chats" ON public.chats;
CREATE POLICY "Businesses manage own chats"
  ON public.chats FOR ALL TO authenticated
  USING (business_id = auth.uid())
  WITH CHECK (business_id = auth.uid());
