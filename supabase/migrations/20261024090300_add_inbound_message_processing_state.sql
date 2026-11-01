-- Durable processing state for inbound WhatsApp messages.
--
-- The unique index on (chat_id, external_message_id) prevents duplicate
-- customer rows, but by itself it also makes Meta retries a no-op forever:
-- if the first request crashes after inserting the customer message but before
-- writing the AI reply, every later duplicate is discarded.
--
-- These columns + RPCs add a small claim/finish state machine:
--   pending    -> customer row inserted, not yet claimed
--   processing -> one worker owns the message
--   done       -> reply persisted (or the chat is human-controlled)
--   failed     -> processing raised; a later retry may claim it again
--
-- A stale `processing` row can be reclaimed after the stale window (10 min),
-- which is longer than the agent's normal worst-case runtime. Existing rows
-- default to `done`, so no historical message is reprocessed.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_external_message_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_processing_status_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_processing_status_check
      CHECK (processing_status IN ('pending', 'processing', 'done', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS messages_pending_processing_idx
  ON public.messages (chat_id, processing_status)
  WHERE external_message_id IS NOT NULL
    AND processing_status <> 'done';

-- Hard guarantee: at most one bot reply can be linked to one inbound message.
-- Two workers that both run after a stale reclaim cannot persist two replies.
CREATE UNIQUE INDEX IF NOT EXISTS messages_reply_to_external_unique
  ON public.messages (chat_id, reply_to_external_message_id)
  WHERE reply_to_external_message_id IS NOT NULL;

-- Atomically claim an inbound message for processing.
-- Returns true only for the caller that won the claim.
CREATE OR REPLACE FUNCTION public.claim_inbound_message(
  p_chat_id uuid,
  p_external_message_id text,
  p_stale_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed boolean;
BEGIN
  IF p_external_message_id IS NULL OR p_stale_seconds < 0 THEN
    RETURN false;
  END IF;

  UPDATE public.messages
  SET processing_status = 'processing',
      processing_started_at = now()
  WHERE chat_id = p_chat_id
    AND external_message_id = p_external_message_id
    AND (
      processing_status IN ('pending', 'failed')
      OR (
        processing_status = 'processing'
        AND (
          processing_started_at IS NULL
          OR processing_started_at < now() - make_interval(secs => p_stale_seconds)
        )
      )
    )
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inbound_message(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_message(uuid, text, integer)
  TO service_role;

-- Mark a claimed inbound message as finished.
CREATE OR REPLACE FUNCTION public.finish_inbound_message(
  p_chat_id uuid,
  p_external_message_id text,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'Invalid inbound processing status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages
  SET processing_status = p_status,
      processed_at = now()
  WHERE chat_id = p_chat_id
    AND external_message_id = p_external_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_inbound_message(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_inbound_message(uuid, text, text)
  TO service_role;
