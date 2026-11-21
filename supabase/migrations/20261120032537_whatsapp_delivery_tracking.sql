-- API acceptance and provider delivery are separate facts. Keep every attempt's ID.
ALTER TABLE public.messages
  ADD COLUMN provider_message_id text,
  ADD COLUMN provider_phone_number_id text,
  ADD COLUMN provider_delivery_status text CHECK (provider_delivery_status IN ('accepted','sent','delivered','read','failed')),
  ADD COLUMN provider_status_at timestamptz;

ALTER TABLE public.profiles ADD COLUMN weekly_report_provider_message_id text,
  ADD COLUMN weekly_report_provider_status text,
  ADD COLUMN weekly_report_delivery_error text;

CREATE TABLE public.whatsapp_outbound_messages (
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  provider_message_id text NOT NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  context text NOT NULL DEFAULT 'message' CHECK(context IN ('message','weekly_report')),
  provider_status text NOT NULL DEFAULT 'accepted',
  provider_status_at timestamptz,
  last_error text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, phone_number_id, provider_message_id)
);
CREATE INDEX whatsapp_outbound_message_id_idx ON public.whatsapp_outbound_messages(message_id);
ALTER TABLE public.whatsapp_outbound_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_outbound_messages FROM anon, authenticated;
GRANT ALL ON public.whatsapp_outbound_messages TO service_role;

-- Unmatched early events remain here until the send response binds its wamid.
CREATE TABLE public.whatsapp_delivery_events (
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  provider_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
  occurred_at timestamptz NOT NULL,
  error_message text,
  PRIMARY KEY (business_id, phone_number_id, provider_message_id, status)
);
ALTER TABLE public.whatsapp_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_delivery_events FROM anon, authenticated;
GRANT ALL ON public.whatsapp_delivery_events TO service_role;

CREATE FUNCTION public.reconcile_whatsapp_delivery(p_business_id uuid, p_phone_number_id text, p_provider_message_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event record;
BEGIN
  SELECT * INTO event FROM public.whatsapp_delivery_events
  WHERE business_id=p_business_id AND phone_number_id=p_phone_number_id AND provider_message_id=p_provider_message_id
  ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC, occurred_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.whatsapp_outbound_messages SET provider_status=event.status,provider_status_at=event.occurred_at,
    last_error=CASE WHEN event.status='failed' THEN event.error_message ELSE NULL END
    WHERE business_id=p_business_id AND phone_number_id=p_phone_number_id AND provider_message_id=p_provider_message_id;
  UPDATE public.profiles SET weekly_report_provider_status=event.status,
    weekly_report_delivery_error=CASE WHEN event.status='failed' THEN event.error_message ELSE NULL END
    WHERE id=p_business_id AND weekly_report_provider_message_id=p_provider_message_id;
  UPDATE public.messages m SET provider_delivery_status=event.status, provider_status_at=event.occurred_at,
    delivery_status=CASE WHEN event.status='failed' THEN 'failed' ELSE 'sent' END,
    last_delivery_error=CASE WHEN event.status='failed' THEN event.error_message ELSE NULL END
  FROM public.whatsapp_outbound_messages o, public.chats c
  WHERE o.business_id=p_business_id AND o.phone_number_id=p_phone_number_id AND o.provider_message_id=p_provider_message_id
    AND m.id=o.message_id AND c.id=m.chat_id AND c.business_id=p_business_id
    AND m.provider_message_id=p_provider_message_id AND m.provider_phone_number_id=p_phone_number_id;
END $$;

CREATE FUNCTION public.register_whatsapp_acceptance(p_business_id uuid, p_message_id uuid, p_phone_number_id text, p_provider_message_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_message uuid;
BEGIN
  IF length(p_provider_message_id) NOT BETWEEN 1 AND 512 OR length(p_phone_number_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Invalid provider identity' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_phone_number_id||':'||p_provider_message_id,0));
  PERFORM 1 FROM public.messages m JOIN public.chats c ON c.id=m.chat_id
    WHERE m.id=p_message_id AND c.business_id=p_business_id AND m.sender IN ('human','bot') FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outbound message owner mismatch' USING ERRCODE='42501'; END IF;
  SELECT message_id INTO existing_message FROM public.whatsapp_outbound_messages
    WHERE business_id=p_business_id AND phone_number_id=p_phone_number_id AND provider_message_id=p_provider_message_id;
  IF FOUND THEN
    IF existing_message<>p_message_id THEN RAISE EXCEPTION 'Provider ID already bound' USING ERRCODE='23505'; END IF;
    PERFORM public.reconcile_whatsapp_delivery(p_business_id,p_phone_number_id,p_provider_message_id);
    RETURN;
  END IF;
  INSERT INTO public.whatsapp_outbound_messages(business_id,phone_number_id,provider_message_id,message_id)
    VALUES(p_business_id,p_phone_number_id,p_provider_message_id,p_message_id);
  UPDATE public.messages SET provider_message_id=p_provider_message_id, provider_phone_number_id=p_phone_number_id,
    provider_delivery_status='accepted',provider_status_at=now(),delivery_status='sent',sent_at=COALESCE(sent_at,now()),last_delivery_error=NULL
    WHERE id=p_message_id;
  PERFORM public.reconcile_whatsapp_delivery(p_business_id,p_phone_number_id,p_provider_message_id);
END $$;

CREATE FUNCTION public.record_whatsapp_delivery_status(p_business_id uuid, p_phone_number_id text, p_provider_message_id text,
  p_status text, p_occurred_at timestamptz, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('sent','delivered','read','failed') OR p_occurred_at IS NULL
    OR length(p_provider_message_id) NOT BETWEEN 1 AND 512 OR length(p_phone_number_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Invalid delivery event' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_phone_number_id||':'||p_provider_message_id,0));
  INSERT INTO public.whatsapp_delivery_events(business_id,phone_number_id,provider_message_id,status,occurred_at,error_message)
    VALUES(p_business_id,p_phone_number_id,p_provider_message_id,p_status,p_occurred_at,left(p_error,500))
  ON CONFLICT (business_id,phone_number_id,provider_message_id,status) DO UPDATE
    SET occurred_at=GREATEST(public.whatsapp_delivery_events.occurred_at,EXCLUDED.occurred_at),
      error_message=CASE WHEN EXCLUDED.occurred_at>=public.whatsapp_delivery_events.occurred_at THEN EXCLUDED.error_message ELSE public.whatsapp_delivery_events.error_message END;
  PERFORM public.reconcile_whatsapp_delivery(p_business_id,p_phone_number_id,p_provider_message_id);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_whatsapp_delivery(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_whatsapp_acceptance(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_whatsapp_delivery_status(uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_acceptance(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_delivery_status(uuid,text,text,text,timestamptz,text) TO service_role;

CREATE FUNCTION public.register_whatsapp_report_acceptance(p_business_id uuid,p_phone_number_id text,p_provider_message_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_provider_message_id IS NULL OR length(p_provider_message_id) NOT BETWEEN 1 AND 512
    OR p_phone_number_id IS NULL OR length(p_phone_number_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Invalid provider identity' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_phone_number_id||':'||p_provider_message_id,0));
  INSERT INTO public.whatsapp_outbound_messages(business_id,phone_number_id,provider_message_id,context)
    VALUES(p_business_id,p_phone_number_id,p_provider_message_id,'weekly_report') ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET weekly_report_provider_message_id=p_provider_message_id,
    weekly_report_provider_status='accepted',weekly_report_delivery_error=NULL WHERE id=p_business_id;
  PERFORM public.reconcile_whatsapp_delivery(p_business_id,p_phone_number_id,p_provider_message_id);
END $$;
REVOKE ALL ON FUNCTION public.register_whatsapp_report_acceptance(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_report_acceptance(uuid,text,text) TO service_role;
