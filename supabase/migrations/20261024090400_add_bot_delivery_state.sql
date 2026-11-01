-- Track outbound WhatsApp delivery separately from reply persistence.
--
-- A bot reply can be persisted successfully while the WhatsApp API call fails.
-- Before this migration the inbound message was marked done immediately, so a
-- retry never resubmitted the reply. These columns + RPCs add an outbound
-- delivery claim so retries resend the existing reply instead of generating a
-- second one.
--
-- delivery_status:
--   NULL      -> not an outbound reply (customer/system/human/legacy rows)
--   pending   -> reply persisted, not yet submitted
--   sending   -> a worker is submitting it (lease)
--   sent      -> WhatsApp API accepted the submission
--   failed    -> submission failed; a retry may reclaim it
--
-- A stale `sending` lease can be reclaimed after 2 minutes. The unique linked
-- reply index from 20261024090300 still prevents two persisted bot replies for
-- the same inbound message.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivery_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_delivery_status_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_delivery_status_check
      CHECK (
        delivery_status IS NULL
        OR delivery_status IN ('pending', 'sending', 'sent', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS messages_pending_delivery_idx
  ON public.messages (delivery_status)
  WHERE sender = 'bot'
    AND delivery_status IN ('pending', 'sending', 'failed');

-- Atomically claim an outbound bot reply for submission.
CREATE OR REPLACE FUNCTION public.claim_outbound_message(
  p_message_id uuid,
  p_stale_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed boolean;
BEGIN
  IF p_message_id IS NULL OR p_stale_seconds < 0 THEN
    RETURN false;
  END IF;

  UPDATE public.messages
  SET delivery_status = 'sending',
      delivery_started_at = now(),
      delivery_attempts = delivery_attempts + 1
  WHERE id = p_message_id
    AND sender = 'bot'
    AND (
      delivery_status IN ('pending', 'failed')
      OR (
        delivery_status = 'sending'
        AND (
          delivery_started_at IS NULL
          OR delivery_started_at < now() - make_interval(secs => p_stale_seconds)
        )
      )
    )
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outbound_message(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbound_message(uuid, integer)
  TO service_role;

-- Record the result of an outbound submission attempt.
CREATE OR REPLACE FUNCTION public.finish_outbound_message(
  p_message_id uuid,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Invalid outbound delivery status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages
  SET delivery_status = p_status,
      delivery_started_at = NULL,
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
      last_delivery_error = CASE
        WHEN p_status = 'failed' THEN left(coalesce(p_error, 'unknown error'), 1000)
        ELSE NULL
      END
  WHERE id = p_message_id
    AND sender = 'bot';
END;
$$;

REVOKE ALL ON FUNCTION public.finish_outbound_message(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_outbound_message(uuid, text, text)
  TO service_role;
