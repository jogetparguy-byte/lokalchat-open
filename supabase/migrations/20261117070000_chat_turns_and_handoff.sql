-- Bot epochs invalidate answers across pause/resume, including persisted retries.
ALTER TABLE public.chats ADD COLUMN bot_generation integer NOT NULL DEFAULT 0;
ALTER TABLE public.messages ADD COLUMN processing_token uuid,
  ADD COLUMN bot_generation integer,
  ADD COLUMN bot_reply_kind text CHECK (bot_reply_kind IN ('answer', 'handoff'));
-- Preserve recoverability of customer jobs accepted before epochs existed.
UPDATE public.messages m SET bot_generation=c.bot_generation FROM public.chats c
WHERE m.chat_id=c.id AND m.sender='customer';
ALTER TABLE public.messages DROP CONSTRAINT messages_delivery_status_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('pending','sending','sent','failed','cancelled'));

CREATE FUNCTION public.advance_bot_generation() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  NEW.bot_generation := OLD.bot_generation + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER chats_bot_generation BEFORE UPDATE OF is_bot_active ON public.chats
FOR EACH ROW EXECUTE FUNCTION public.advance_bot_generation();
REVOKE ALL ON FUNCTION public.advance_bot_generation() FROM PUBLIC, anon, authenticated;

-- A stale model cannot pause a resumed chat or authorize its own stale confirmation.
CREATE FUNCTION public.handoff_chat(p_chat_id uuid, p_generation integer, p_token uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE generation integer;
BEGIN
  PERFORM 1 FROM public.chats WHERE id=p_chat_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE chat_id=p_chat_id AND sender='customer'
    AND processing_status='processing' AND processing_token=p_token) THEN RETURN NULL; END IF;
  UPDATE public.chats SET is_bot_active = false
  WHERE id = p_chat_id AND is_bot_active AND bot_generation = p_generation
  RETURNING bot_generation INTO generation;
  RETURN generation;
END $$;

CREATE OR REPLACE FUNCTION public.claim_inbound_message(
  p_chat_id uuid, p_external_message_id text, p_stale_seconds integer DEFAULT 600
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE candidate public.messages%ROWTYPE; claimed boolean;
BEGIN
  IF p_stale_seconds < 600 THEN RETURN false; END IF;
  -- All claimers for this chat serialize through this short transaction lock.
  PERFORM 1 FROM public.chats WHERE id = p_chat_id FOR UPDATE;
  SELECT * INTO candidate FROM public.messages
  WHERE chat_id = p_chat_id AND external_message_id = p_external_message_id AND sender = 'customer';
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.messages m WHERE m.chat_id = p_chat_id
    AND m.sender = 'customer' AND m.external_message_id IS NOT NULL
    AND m.processing_status <> 'done'
    AND NOT (m.processing_status = 'failed' AND m.processing_attempts >= 8)
    AND (m.created_at, m.id) < (candidate.created_at, candidate.id)) THEN RETURN false; END IF;
  UPDATE public.messages SET processing_status='processing', processing_started_at=now(), processing_token=gen_random_uuid(),
    processing_attempts=processing_attempts+1
  WHERE id = candidate.id AND processing_attempts < 8
    AND (processing_status='pending'
      OR (processing_status='failed' AND processed_at < now()-interval '1 minute')
      OR (processing_status='processing' AND
        (processing_started_at IS NULL OR processing_started_at < now()-make_interval(secs=>p_stale_seconds))))
  RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END $$;
CREATE INDEX messages_chat_turn_idx ON public.messages(chat_id, created_at, id)
WHERE sender='customer' AND external_message_id IS NOT NULL AND processing_status <> 'done';

-- Serialize authorization with pause/resume and verify each individual part.
CREATE FUNCTION public.claim_bot_reply(p_message_id uuid, p_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE msg public.messages%ROWTYPE; chat public.chats%ROWTYPE;
BEGIN
  SELECT * INTO msg FROM public.messages WHERE id=p_message_id AND sender='bot';
  IF NOT FOUND THEN RETURN 'busy'; END IF;
  SELECT * INTO chat FROM public.chats WHERE id=msg.chat_id FOR UPDATE;
  SELECT * INTO msg FROM public.messages WHERE id=p_message_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.messages inbound WHERE inbound.chat_id=msg.chat_id
    AND inbound.external_message_id=msg.reply_to_external_message_id AND inbound.sender='customer'
    AND inbound.processing_status='processing' AND inbound.processing_token=p_token) THEN RETURN 'busy'; END IF;
  IF msg.delivery_status='sent' THEN RETURN 'sent'; END IF;
  IF msg.delivery_status='cancelled' THEN RETURN 'cancelled'; END IF;
  IF msg.bot_generation IS DISTINCT FROM chat.bot_generation
    OR (NOT chat.is_bot_active AND msg.bot_reply_kind IS DISTINCT FROM 'handoff') THEN
    UPDATE public.messages SET delivery_status='cancelled',
      last_delivery_error='Bot reply cancelled after chat takeover or state change'
    WHERE id=p_message_id;
    RETURN 'cancelled';
  END IF;
  IF public.claim_outbound_message(p_message_id) THEN RETURN 'claimed'; END IF;
  RETURN 'busy';
END $$;
REVOKE ALL ON FUNCTION public.handoff_chat(uuid,integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_bot_reply(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_chat(uuid,integer,uuid), public.claim_bot_reply(uuid,uuid) TO service_role;

-- Simulator turns use the same durable ordering, retaining their transport policy.
ALTER TABLE public.messages ADD COLUMN allow_dry_run boolean NOT NULL DEFAULT false;
DROP FUNCTION public.list_recoverable_inbound_messages();
CREATE FUNCTION public.list_recoverable_inbound_messages()
RETURNS TABLE(id uuid, chat_id uuid, business_id uuid, customer_phone text, text text, external_message_id text, allow_dry_run boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.messages m SET processing_status='failed', processed_at=now()
  WHERE m.sender='customer' AND m.processing_attempts>=8 AND m.processing_status='processing'
    AND (m.processing_started_at IS NULL OR m.processing_started_at < now()-interval '10 minutes');
  RETURN QUERY SELECT m.id,m.chat_id,c.business_id,c.customer_phone,m.text,m.external_message_id,m.allow_dry_run
  FROM public.messages m JOIN public.chats c ON c.id=m.chat_id
  WHERE m.sender='customer' AND m.external_message_id IS NOT NULL AND m.processing_attempts<8
    AND (m.processing_status='pending'
      OR (m.processing_status='failed' AND m.processed_at < now()-interval '1 minute')
      OR (m.processing_status='processing' AND
        (m.processing_started_at IS NULL OR m.processing_started_at < now()-interval '10 minutes')))
    AND NOT EXISTS (SELECT 1 FROM public.messages earlier WHERE earlier.chat_id=m.chat_id
      AND earlier.sender='customer' AND earlier.external_message_id IS NOT NULL
      AND earlier.processing_status<>'done'
      AND NOT (earlier.processing_status='failed' AND earlier.processing_attempts>=8)
      AND (earlier.created_at,earlier.id)<(m.created_at,m.id))
  ORDER BY m.created_at,m.id LIMIT 20;
END $$;
REVOKE ALL ON FUNCTION public.list_recoverable_inbound_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_recoverable_inbound_messages() TO service_role;

-- Later queued customer turns and cancelled/pending bot drafts must not leak into this turn's prompt.
CREATE FUNCTION public.load_chat_turn_history(p_chat_id uuid, p_external_message_id text)
RETURNS TABLE(sender text, text text) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT recent.sender::text,recent.text FROM (
    SELECT m.sender,m.text,m.created_at,m.reply_sequence,m.id FROM public.messages m
    WHERE m.chat_id=p_chat_id AND (
      (m.sender='customer' AND (m.processing_status='done' OR m.external_message_id=p_external_message_id))
      OR (m.sender IN ('bot','human') AND m.delivery_status='sent'))
    ORDER BY m.created_at DESC,m.reply_sequence DESC,m.id DESC LIMIT 16
  ) recent ORDER BY recent.created_at,recent.reply_sequence,recent.id;
$$;
REVOKE ALL ON FUNCTION public.load_chat_turn_history(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_chat_turn_history(uuid,text) TO service_role;

-- Attempt tokens prevent an expired worker from sending or completing a newer attempt.
CREATE FUNCTION public.claim_chat_turn(p_chat_id uuid, p_external_message_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE token uuid;
BEGIN
  IF NOT public.claim_inbound_message(p_chat_id,p_external_message_id) THEN RETURN NULL; END IF;
  SELECT processing_token INTO token FROM public.messages
    WHERE chat_id=p_chat_id AND external_message_id=p_external_message_id AND sender='customer';
  IF EXISTS (SELECT 1 FROM public.messages m JOIN public.chats c ON c.id=m.chat_id
    WHERE m.chat_id=p_chat_id AND m.external_message_id=p_external_message_id
      AND m.sender='customer' AND m.bot_generation IS DISTINCT FROM c.bot_generation) THEN
    UPDATE public.messages SET processing_status='done', processed_at=now()
      WHERE chat_id=p_chat_id AND external_message_id=p_external_message_id AND processing_token=token;
    RETURN NULL;
  END IF;
  RETURN token;
END $$;
CREATE FUNCTION public.finish_chat_turn(p_chat_id uuid, p_external_message_id text, p_token uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('done','failed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.messages SET processing_status=p_status,processed_at=now()
  WHERE chat_id=p_chat_id AND external_message_id=p_external_message_id AND sender='customer'
    AND processing_token=p_token AND processing_status='processing';
END $$;
REVOKE ALL ON FUNCTION public.claim_chat_turn(uuid,text), public.finish_chat_turn(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_turn(uuid,text), public.finish_chat_turn(uuid,text,uuid,text) TO service_role;
