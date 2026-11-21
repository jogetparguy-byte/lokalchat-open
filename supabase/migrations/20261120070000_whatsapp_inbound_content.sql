ALTER TABLE public.chats ADD COLUMN customer_bsuid text,
  ADD COLUMN customer_phone_number text;
CREATE UNIQUE INDEX chats_business_bsuid_unique ON public.chats(business_id, customer_bsuid)
  WHERE customer_bsuid IS NOT NULL;
ALTER TABLE public.messages ADD COLUMN inbound_type text,
  ADD COLUMN inbound_metadata jsonb;

-- One transaction persists content, deduplicates and pauses unreadable content before the worker can claim it.
CREATE FUNCTION public.persist_whatsapp_inbound(
  p_business_id uuid, p_external_message_id text, p_phone text, p_bsuid text,
  p_name text, p_type text, p_text text, p_metadata jsonb, p_needs_handoff boolean,
  p_phone_number_id text, p_provider_timestamp timestamptz DEFAULT NULL
) RETURNS TABLE(chat_id uuid, recipient_id text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE selected_chat public.chats%ROWTYPE; inserted_id uuid; matches integer;
BEGIN
  IF nullif(p_external_message_id, '') IS NULL OR nullif(p_text, '') IS NULL
    OR (p_phone IS NULL AND p_bsuid IS NULL)
    OR (p_phone IS NOT NULL AND p_phone !~ '^[0-9]{7,20}$')
    OR (p_bsuid IS NOT NULL AND p_bsuid !~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$') THEN
    RAISE EXCEPTION 'Invalid WhatsApp inbound identity or content';
  END IF;
  -- Serialize alias attachment within this account, including simultaneous first contact by phone and BSUID.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 7007));
  SELECT count(*) INTO matches FROM public.chats c WHERE c.business_id=p_business_id AND
    ((p_bsuid IS NOT NULL AND (c.customer_bsuid=p_bsuid OR c.customer_phone=p_bsuid))
      OR (p_phone IS NOT NULL AND (c.customer_phone=p_phone OR c.customer_phone_number=p_phone)));
  IF matches > 1 THEN RAISE EXCEPTION 'Conflicting WhatsApp customer identities require reconciliation'; END IF;
  SELECT * INTO selected_chat FROM public.chats c WHERE c.business_id=p_business_id AND
    ((p_bsuid IS NOT NULL AND (c.customer_bsuid=p_bsuid OR c.customer_phone=p_bsuid))
      OR (p_phone IS NOT NULL AND (c.customer_phone=p_phone OR c.customer_phone_number=p_phone))) FOR UPDATE;
  IF FOUND AND selected_chat.customer_bsuid IS NOT NULL AND p_bsuid IS NOT NULL
    AND selected_chat.customer_bsuid <> p_bsuid THEN
    RAISE EXCEPTION 'Conflicting WhatsApp BSUID requires reconciliation';
  END IF;
  IF selected_chat.id IS NULL THEN
    INSERT INTO public.chats(business_id,customer_phone,customer_bsuid,customer_phone_number,customer_name)
      VALUES(p_business_id,coalesce(p_bsuid,p_phone),p_bsuid,p_phone,p_name) RETURNING * INTO selected_chat;
  END IF;
  -- Replays do not re-pause a resumed chat, replace a newer preview or repeat the handoff note.
  IF NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.chat_id=selected_chat.id AND m.external_message_id=p_external_message_id) THEN
  UPDATE public.chats SET customer_bsuid=coalesce(p_bsuid,customer_bsuid),
    customer_phone_number=coalesce(p_phone,customer_phone_number),
    customer_phone=coalesce(p_bsuid,customer_bsuid,customer_phone),
    customer_name=coalesce(p_name,customer_name),last_message=p_text,updated_at=now()
    WHERE id=selected_chat.id RETURNING * INTO selected_chat;
  IF p_needs_handoff AND selected_chat.is_bot_active THEN
    UPDATE public.chats SET is_bot_active=false WHERE id=selected_chat.id RETURNING * INTO selected_chat;
  END IF;
  INSERT INTO public.messages(chat_id,sender,text,external_message_id,processing_status,processed_at,
    bot_generation,allow_dry_run,inbound_type,inbound_metadata)
    VALUES(selected_chat.id,'customer',p_text,p_external_message_id,
      CASE WHEN p_needs_handoff THEN 'done' ELSE 'pending' END,
      CASE WHEN p_needs_handoff THEN now() ELSE NULL END,
      selected_chat.bot_generation,false,p_type,p_metadata) RETURNING id INTO inserted_id;
  IF p_needs_handoff THEN
    INSERT INTO public.messages(chat_id,sender,text) VALUES(selected_chat.id,'system',
      'Semakan manusia diperlukan: mesej ' || p_type || ' disimpan. Bot dijeda kerana kandungan tidak dapat dibaca secara automatik.');
  END IF;
  END IF;
  -- The service-window function is installed by the following GAP-008 migration.
  -- Updating the window in this transaction prevents recovery claiming a pending message first.
  IF p_provider_timestamp IS NOT NULL THEN
    PERFORM public.record_whatsapp_customer_event(p_business_id,p_phone_number_id,selected_chat.customer_phone,p_provider_timestamp);
  END IF;
  RETURN QUERY SELECT selected_chat.id, selected_chat.customer_phone;
END $$;
REVOKE ALL ON FUNCTION public.persist_whatsapp_inbound(uuid,text,text,text,text,text,text,jsonb,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_whatsapp_inbound(uuid,text,text,text,text,text,text,jsonb,boolean,text,timestamptz) TO service_role;
