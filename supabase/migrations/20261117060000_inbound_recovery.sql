-- Customer messages are the durable queue. Completed history is never replayed.
ALTER TABLE public.messages ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_inbound_message(
  p_chat_id uuid, p_external_message_id text, p_stale_seconds integer DEFAULT 600
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claimed boolean;
BEGIN
  IF p_external_message_id IS NULL OR p_stale_seconds < 600 THEN RETURN false; END IF;
  UPDATE public.messages SET processing_status = 'processing', processing_started_at = now(),
    processing_attempts = processing_attempts + 1
  WHERE chat_id = p_chat_id AND external_message_id = p_external_message_id
    AND sender = 'customer' AND processing_attempts < 8
    AND (processing_status = 'pending'
      OR (processing_status = 'failed' AND processed_at < now() - interval '1 minute')
      OR (processing_status = 'processing' AND
        (processing_started_at IS NULL OR processing_started_at < now() - make_interval(secs => p_stale_seconds))))
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END $$;

CREATE OR REPLACE FUNCTION public.list_recoverable_inbound_messages()
RETURNS TABLE(id uuid, chat_id uuid, business_id uuid, customer_phone text, text text, external_message_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Exhausted jobs remain visible as failed, including a crash on the final attempt.
  UPDATE public.messages m SET processing_status = 'failed', processed_at = now()
  WHERE m.sender = 'customer' AND m.processing_attempts >= 8
    AND m.processing_status = 'processing'
    AND (m.processing_started_at IS NULL OR m.processing_started_at < now() - interval '10 minutes');
  RETURN QUERY SELECT m.id, m.chat_id, c.business_id, c.customer_phone, m.text, m.external_message_id
  FROM public.messages m JOIN public.chats c ON c.id = m.chat_id
  WHERE m.sender = 'customer' AND m.external_message_id IS NOT NULL AND m.processing_attempts < 8
    AND (m.processing_status = 'pending'
      OR (m.processing_status = 'failed' AND m.processed_at < now() - interval '1 minute')
      OR (m.processing_status = 'processing' AND
        (m.processing_started_at IS NULL OR m.processing_started_at < now() - interval '10 minutes')))
  ORDER BY m.created_at, m.id LIMIT 20;
END $$;
REVOKE ALL ON FUNCTION public.list_recoverable_inbound_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_recoverable_inbound_messages() TO service_role;
REVOKE ALL ON FUNCTION public.claim_inbound_message(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_message(uuid, text, integer) TO service_role;
CREATE INDEX messages_recovery_idx ON public.messages (processing_status, created_at)
WHERE sender = 'customer' AND external_message_id IS NOT NULL AND processing_status <> 'done';
