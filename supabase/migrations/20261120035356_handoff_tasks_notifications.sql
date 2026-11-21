ALTER TABLE public.profiles ADD COLUMN handoff_notification_channel text NOT NULL DEFAULT 'in_app'
  CHECK(handoff_notification_channel IN ('in_app','whatsapp'));
CREATE TABLE public.handoff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
  accepted_at timestamptz,
  resolved_at timestamptz,
  UNIQUE(chat_id,source_key)
);
CREATE UNIQUE INDEX handoff_tasks_one_open ON public.handoff_tasks(chat_id) WHERE status<>'resolved';
CREATE INDEX handoff_tasks_owner_status ON public.handoff_tasks(business_id,status,created_at);
ALTER TABLE public.handoff_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.handoff_tasks FROM anon,authenticated;
GRANT SELECT ON public.handoff_tasks TO authenticated;
GRANT ALL ON public.handoff_tasks TO service_role;
CREATE POLICY handoff_tasks_owner_read ON public.handoff_tasks FOR SELECT TO authenticated USING(business_id=(SELECT auth.uid()));
CREATE TABLE public.handoff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.handoff_tasks(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('initial','escalation')),
  channel text NOT NULL CHECK(channel IN ('in_app','whatsapp')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','retry','published','accepted','failed','uncertain','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  provider_message_id text,
  provider_phone_number_id text,
  provider_delivery_status text,
  UNIQUE(task_id,stage)
);
CREATE INDEX handoff_notifications_due ON public.handoff_notifications(next_attempt_at) WHERE status IN ('pending','retry');
CREATE INDEX handoff_notifications_owner ON public.handoff_notifications(business_id,task_id);
ALTER TABLE public.handoff_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.handoff_notifications FROM anon,authenticated;
GRANT SELECT ON public.handoff_notifications TO authenticated;
GRANT ALL ON public.handoff_notifications TO service_role;
CREATE POLICY handoff_notifications_owner_read ON public.handoff_notifications FOR SELECT TO authenticated USING(business_id=(SELECT auth.uid()));

CREATE FUNCTION public.ensure_handoff_task(p_chat_id uuid,p_source_key text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chat public.chats%ROWTYPE; task uuid; channel text;
BEGIN
 SELECT * INTO chat FROM public.chats WHERE id=p_chat_id FOR UPDATE;
 IF NOT FOUND OR chat.is_bot_active THEN RETURN NULL; END IF;
 SELECT id INTO task FROM public.handoff_tasks WHERE chat_id=p_chat_id AND status<>'resolved';
 IF FOUND THEN RETURN task; END IF;
 INSERT INTO public.handoff_tasks(business_id,chat_id,source_key) VALUES(chat.business_id,chat.id,p_source_key)
 ON CONFLICT(chat_id,source_key) DO NOTHING RETURNING id INTO task;
 IF task IS NULL THEN RETURN NULL; END IF;
 SELECT handoff_notification_channel INTO channel FROM public.profiles WHERE id=chat.business_id;
 INSERT INTO public.handoff_notifications(task_id,business_id,stage,channel) VALUES(task,chat.business_id,'initial',channel);
 INSERT INTO public.handoff_events(chat_id,business_id) VALUES(chat.id,chat.business_id);
 RETURN task;
END $$;
CREATE FUNCTION public.queue_handoff_on_pause() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT NEW.is_bot_active AND OLD.is_bot_active THEN
  PERFORM public.ensure_handoff_task(NEW.id,'epoch:'||NEW.bot_generation::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_task_on_pause AFTER UPDATE OF is_bot_active ON public.chats FOR EACH ROW EXECUTE FUNCTION public.queue_handoff_on_pause();
CREATE FUNCTION public.queue_handoff_on_paused_inbound() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.sender='customer' THEN PERFORM public.ensure_handoff_task(NEW.chat_id,'inbound:'||NEW.id::text); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_task_on_inbound AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.queue_handoff_on_paused_inbound();
-- Existing paused conversations become visible without pretending an external alert was sent.
DO $$ DECLARE chat record; BEGIN FOR chat IN SELECT id,bot_generation FROM public.chats WHERE NOT is_bot_active LOOP
 PERFORM public.ensure_handoff_task(chat.id,'backfill:'||chat.bot_generation::text);
END LOOP; END $$;

CREATE FUNCTION public.transition_handoff_task(p_task_id uuid,p_expected_status text,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed uuid;
BEGIN
 IF NOT ((p_expected_status='pending' AND p_status='accepted') OR (p_expected_status='accepted' AND p_status='resolved')) THEN
  RAISE EXCEPTION 'Invalid handoff transition' USING ERRCODE='22023'; END IF;
 UPDATE public.handoff_tasks SET status=p_status,
   accepted_at=CASE WHEN p_status='accepted' THEN now() ELSE accepted_at END,
   resolved_at=CASE WHEN p_status='resolved' THEN now() ELSE resolved_at END
 WHERE id=p_task_id AND business_id=(SELECT auth.uid()) AND status=p_expected_status RETURNING id INTO changed;
 RETURN changed IS NOT NULL;
END $$;
CREATE FUNCTION public.claim_handoff_notifications() RETURNS SETOF public.handoff_notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A stale provider submission may already have been accepted. Never blindly resend it.
 UPDATE public.handoff_notifications SET status='uncertain',last_error='Status amaran belum disahkan. Semak sebelum cuba semula.',completed_at=now(),lease_token=NULL
 WHERE status='sending' AND started_at<now()-interval '5 minutes';
 INSERT INTO public.handoff_notifications(task_id,business_id,stage,channel)
 SELECT t.id,t.business_id,'escalation',p.handoff_notification_channel FROM public.handoff_tasks t
 JOIN public.profiles p ON p.id=t.business_id WHERE t.status='pending' AND t.due_at<=now()
 ON CONFLICT(task_id,stage) DO NOTHING;
 UPDATE public.handoff_notifications n SET status='skipped',completed_at=now()
 FROM public.handoff_tasks t WHERE t.id=n.task_id AND t.status<>'pending' AND n.status IN ('pending','retry');
 RETURN QUERY WITH due AS (
 SELECT n.id FROM public.handoff_notifications n JOIN public.handoff_tasks t ON t.id=n.task_id
 WHERE n.status IN ('pending','retry') AND n.next_attempt_at<=now() AND n.attempts<5 AND t.status='pending'
 ORDER BY n.next_attempt_at LIMIT 50 FOR UPDATE OF n SKIP LOCKED)
 UPDATE public.handoff_notifications n SET status='sending',started_at=now(),attempts=n.attempts+1,lease_token=gen_random_uuid()
 FROM due WHERE n.id=due.id RETURNING n.*;
END $$;
CREATE FUNCTION public.finish_handoff_notification(p_id uuid,p_token uuid,p_status text,p_error text DEFAULT NULL,
 p_provider_message_id text DEFAULT NULL,p_phone_number_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed uuid; owner_id uuid;
BEGIN
 IF p_provider_message_id IS NOT NULL THEN
  SELECT business_id INTO owner_id FROM public.handoff_notifications WHERE id=p_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text||':'||p_phone_number_id||':'||p_provider_message_id,0));
 END IF;
 IF p_status NOT IN ('published','accepted','failed','retry','uncertain','skipped') THEN RAISE EXCEPTION 'Invalid notification status' USING ERRCODE='22023'; END IF;
 UPDATE public.handoff_notifications SET status=CASE WHEN p_status='retry' AND attempts>=5 THEN 'failed' ELSE p_status END,
 completed_at=CASE WHEN p_status='retry' AND attempts<5 THEN NULL ELSE now() END,
 next_attempt_at=now()+make_interval(secs=>LEAST(1800,30*power(2,attempts-1)::integer)),last_error=left(p_error,500),
 provider_message_id=p_provider_message_id,provider_phone_number_id=p_phone_number_id,
 provider_delivery_status=CASE WHEN p_status='accepted' THEN 'accepted' ELSE provider_delivery_status END,lease_token=NULL
 WHERE id=p_id AND status='sending' AND lease_token=p_token RETURNING id INTO changed;
 IF changed IS NOT NULL AND p_provider_message_id IS NOT NULL THEN
  PERFORM public.reconcile_whatsapp_delivery(owner_id,p_phone_number_id,p_provider_message_id);
 END IF;
 RETURN changed IS NOT NULL;
END $$;
CREATE FUNCTION public.retry_handoff_notification(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed uuid;
BEGIN
 UPDATE public.handoff_notifications n SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL
 FROM public.handoff_tasks t WHERE n.id=p_id AND n.business_id=(SELECT auth.uid()) AND t.id=n.task_id AND t.status='pending'
 AND n.status IN ('failed','uncertain') RETURNING n.id INTO changed;
 RETURN changed IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.ensure_handoff_task(uuid,text),public.queue_handoff_on_pause(),public.queue_handoff_on_paused_inbound(),
 public.transition_handoff_task(uuid,text,text),public.claim_handoff_notifications(),public.finish_handoff_notification(uuid,uuid,text,text,text,text),public.retry_handoff_notification(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_handoff_task(uuid,text,text),public.retry_handoff_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_handoff_notifications(),public.finish_handoff_notification(uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_whatsapp_delivery(p_business_id uuid, p_phone_number_id text, p_provider_message_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event record;
BEGIN
  SELECT * INTO event FROM public.whatsapp_delivery_events
  WHERE business_id=p_business_id AND phone_number_id=p_phone_number_id AND provider_message_id=p_provider_message_id
  ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC, occurred_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.handoff_notifications SET provider_delivery_status=event.status,
    last_error=CASE WHEN event.status='failed' THEN event.error_message ELSE NULL END,
    status=CASE WHEN status IN ('accepted','failed') THEN CASE WHEN event.status='failed' THEN 'failed' ELSE 'accepted' END ELSE status END
    WHERE business_id=p_business_id AND provider_phone_number_id=p_phone_number_id AND provider_message_id=p_provider_message_id;
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

