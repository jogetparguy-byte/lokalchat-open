DROP POLICY IF EXISTS "Authenticated owners manage chats" ON public.chats;
DROP POLICY IF EXISTS "Authenticated owners manage knowledge base" ON public.knowledge_base;
DROP POLICY IF EXISTS "Authenticated owners manage messages" ON public.messages;

CREATE POLICY "Businesses manage own chats" ON public.chats
FOR ALL TO authenticated
USING (business_id = auth.uid())
WITH CHECK (business_id = auth.uid());

CREATE POLICY "Businesses manage own knowledge base" ON public.knowledge_base
FOR ALL TO authenticated
USING (business_id = auth.uid())
WITH CHECK (business_id = auth.uid());

CREATE POLICY "Businesses manage own chat messages" ON public.messages
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.chats c WHERE c.id = messages.chat_id AND c.business_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.chats c WHERE c.id = messages.chat_id AND c.business_id = auth.uid()));

DROP FUNCTION IF EXISTS public.match_documents(vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_documents(query_embedding vector, business_id uuid, match_threshold double precision DEFAULT 0.3, match_count integer DEFAULT 3)
RETURNS TABLE(id bigint, content text, similarity double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT kb.id, kb.content, 1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_base kb
  WHERE kb.embedding IS NOT NULL
    AND kb.business_id = match_documents.business_id
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$function$;
