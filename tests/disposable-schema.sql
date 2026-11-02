-- Run only on a disposable Supabase database after the complete migration chain:
-- psql -X -v ON_ERROR_STOP=1 -v DISPOSABLE_TEST=true -f tests/disposable-schema.sql
-- All fixtures roll back. No network calls, cron jobs, or real credentials.
\if :{?DISPOSABLE_TEST}
\else
  \echo 'Refusing to run without explicit -v DISPOSABLE_TEST=true'
  \quit 3
\endif
\if :DISPOSABLE_TEST
\else
  \quit 3
\endif
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions, pg_temp;

-- Parse the same fields read/written by backend functions against the real DB.
SELECT id, business_name, inventory_api_url, system_prompt, role,
       owner_whatsapp, weekly_report_sent_at, simulator_tested_at,
       checklist_dismissed_session, checklist_celebrated_at FROM public.profiles LIMIT 0;
SELECT id, business_id, customer_phone, customer_name, is_bot_active,
       last_message, created_at, updated_at FROM public.chats LIMIT 0;
SELECT id, chat_id, sender, text, external_message_id, processing_status,
       processing_started_at, processed_at, reply_to_external_message_id,
       client_request_id, delivery_status, delivery_started_at, delivery_attempts,
       last_delivery_error, sent_at, created_at FROM public.messages LIMIT 0;
SELECT id, business_id, content, embedding, document_id FROM public.knowledge_base LIMIT 0;
SELECT id, business_id, file_name, file_type, file_size, storage_path,
       status, status_message, created_at, updated_at FROM public.kb_documents LIMIT 0;
SELECT id, business_id, phone_number_id, verify_token, access_token_encrypted,
       app_secret_encrypted, waba_id, display_phone_number, connection_status,
       last_verified_at, last_error_message FROM public.whatsapp_connections LIMIT 0;
SELECT id, provider, api_key_encrypted, is_active, updated_at FROM public.platform_api_keys LIMIT 0;
SELECT id, chat_id, business_id, created_at, ai_reason, ai_suggested_action,
       insight_generated_at FROM public.handoff_events LIMIT 0;
SELECT id, business_id, question, normalized_tokens, embedding, status,
       occurrence_count, failed_after_faq_count, last_failed_after_faq_at,
       faq_id, first_asked_at, last_asked_at, resolved_at, updated_at
  FROM public.unanswered_questions LIMIT 0;
SELECT question_id, business_id, chat_id, question_text, customer_phone,
       customer_name, failed_after_faq, created_at
  FROM public.unanswered_question_occurrences LIMIT 0;

DO $test$
DECLARE
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  chat_a uuid;
  inbound_id text := gen_random_uuid()::text;
  reply_id uuid;
  human_id uuid;
  request_id uuid := gen_random_uuid();
  faq_a bigint;
  question_id uuid;
  embedding vector(1536) := ('[1,' || repeat('0,', 1534) || '0]')::vector;
  row_count integer;
  msg record;
BEGIN
  INSERT INTO auth.users (id, raw_user_meta_data)
    VALUES (owner_a, '{"business_name":"Disposable A"}'),
           (owner_b, '{"business_name":"Disposable B"}');
  IF (SELECT business_name FROM public.profiles WHERE id = owner_a) IS DISTINCT FROM 'Disposable A'
    THEN RAISE EXCEPTION 'Signup trigger did not create the expected profile'; END IF;
  RAISE NOTICE 'PASS signup trigger creates a backend-compatible profile';

  INSERT INTO public.chats (business_id, customer_phone) VALUES (owner_a, 'disposable-same-phone') RETURNING id INTO chat_a;
  INSERT INTO public.chats (business_id, customer_phone) VALUES (owner_b, 'disposable-same-phone');
  BEGIN
    INSERT INTO public.chats (business_id, customer_phone) VALUES (owner_a, 'disposable-same-phone');
    RAISE EXCEPTION 'Duplicate phone accepted within one business';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'PASS customer phone uniqueness is scoped to business';

  INSERT INTO public.knowledge_base (business_id, content, embedding)
    VALUES (owner_a, 'Disposable FAQ A', embedding) RETURNING id INTO faq_a;
  INSERT INTO public.knowledge_base (business_id, content, embedding)
    VALUES (owner_b, 'Disposable FAQ B', embedding);
  SELECT count(*) INTO row_count FROM public.match_documents(
    query_embedding => embedding, business_id => owner_a, match_threshold => 0.3, match_count => 3)
    WHERE id = faq_a AND content = 'Disposable FAQ A' AND similarity > 0.99;
  IF row_count <> 1 THEN RAISE EXCEPTION 'Vector search failed to return matching owner FAQ'; END IF;
  SELECT count(*) INTO row_count FROM public.match_documents(embedding, owner_a, 0.3, 3);
  IF row_count <> 1 THEN RAISE EXCEPTION 'Vector search leaked another business FAQ'; END IF;
  RAISE NOTICE 'PASS 1536-dimensional vector storage/search and tenant filter';

  INSERT INTO public.messages (chat_id, sender, text, external_message_id, processing_status)
    VALUES (chat_a, 'customer', 'Disposable inbound', inbound_id, 'pending');
  IF NOT public.claim_inbound_message(chat_a, inbound_id) THEN RAISE EXCEPTION 'Pending inbound cannot be claimed'; END IF;
  IF public.claim_inbound_message(chat_a, inbound_id) THEN RAISE EXCEPTION 'Inbound lease can be claimed twice'; END IF;
  PERFORM public.finish_inbound_message(chat_a, inbound_id, 'failed');
  IF NOT public.claim_inbound_message(chat_a, inbound_id) THEN RAISE EXCEPTION 'Failed inbound cannot retry'; END IF;
  PERFORM public.finish_inbound_message(chat_a, inbound_id, 'done');
  IF public.claim_inbound_message(chat_a, inbound_id) THEN RAISE EXCEPTION 'Finished inbound can be reclaimed'; END IF;
  BEGIN
    PERFORM public.finish_inbound_message(chat_a, inbound_id, 'invalid');
    RAISE EXCEPTION 'Invalid inbound status accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS inbound processing lease, failed retry and completion';

  INSERT INTO public.messages (chat_id, sender, text, reply_to_external_message_id, delivery_status)
    VALUES (chat_a, 'bot', 'Disposable reply', inbound_id, 'pending') RETURNING id INTO reply_id;
  BEGIN
    INSERT INTO public.messages (chat_id, sender, text, reply_to_external_message_id)
      VALUES (chat_a, 'bot', 'Duplicate reply', inbound_id);
    RAISE EXCEPTION 'Duplicate linked bot reply accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO public.messages (chat_id, sender, text, client_request_id, delivery_status)
    VALUES (chat_a, 'human', 'Disposable human reply', request_id, 'failed') RETURNING id INTO human_id;
  BEGIN
    INSERT INTO public.messages (chat_id, sender, text, client_request_id)
      VALUES (chat_a, 'human', 'Duplicate human reply', request_id);
    RAISE EXCEPTION 'Duplicate human client request accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  FOREACH reply_id IN ARRAY ARRAY[reply_id, human_id] LOOP
    IF NOT public.claim_outbound_message(reply_id) THEN RAISE EXCEPTION 'Outbound cannot be claimed'; END IF;
    IF public.claim_outbound_message(reply_id) THEN RAISE EXCEPTION 'Outbound lease can be claimed twice'; END IF;
    PERFORM public.finish_outbound_message(reply_id, 'failed', repeat('x', 1100));
    IF NOT public.claim_outbound_message(reply_id) THEN RAISE EXCEPTION 'Failed outbound cannot retry'; END IF;
    PERFORM public.finish_outbound_message(reply_id, 'sent');
    SELECT * INTO msg FROM public.messages WHERE id = reply_id;
    IF msg.delivery_attempts <> 2 OR msg.delivery_status <> 'sent' OR msg.last_delivery_error IS NOT NULL OR msg.sent_at IS NULL
      THEN RAISE EXCEPTION 'Outbound final state differs from backend contract'; END IF;
    IF public.claim_outbound_message(reply_id) THEN RAISE EXCEPTION 'Sent outbound can be reclaimed'; END IF;
  END LOOP;
  RAISE NOTICE 'PASS bot/human delivery retries and persisted reply uniqueness';

  INSERT INTO public.unanswered_questions (business_id, question, normalized_tokens, embedding)
    VALUES (owner_a, 'Disposable question?', ARRAY['disposable','question'], embedding) RETURNING id INTO question_id;
  INSERT INTO public.unanswered_question_occurrences (question_id, business_id, chat_id, question_text, failed_after_faq)
    VALUES (question_id, owner_a, chat_a, 'Disposable question?', false);
  UPDATE public.unanswered_questions SET status = 'resolved', faq_id = faq_a, resolved_at = now() WHERE id = question_id;
  DELETE FROM public.knowledge_base WHERE id = faq_a;
  IF (SELECT faq_id FROM public.unanswered_questions WHERE id = question_id) IS NOT NULL
    THEN RAISE EXCEPTION 'Deleting FAQ leaves a dangling unanswered reference'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.internal_settings WHERE key = 'weekly_report_token' AND length(value) >= 32)
    THEN RAISE EXCEPTION 'Fresh weekly report token missing'; END IF;
  RAISE NOTICE 'PASS unanswered capture, FAQ resolution and internal settings initialization';
END
$test$;

ROLLBACK;
\echo 'PASS backend schema compatibility; all disposable fixtures rolled back'
