-- Dashboard delivery visibility + safe retry for failed human replies.
--
-- The outbound claim/finish functions originally handled bot replies only.
-- Human replies now use the same state machine so the dashboard can show
-- sending/sent/failed states and retry a failed reply without creating a new
-- message or sending the same reply twice.
--
-- This migration replaces the function bodies only; it does not touch data,
-- RLS policies, or the existing bot delivery behavior.

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
    AND sender IN ('bot', 'human')
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
    AND sender IN ('bot', 'human');
END;
$$;

REVOKE ALL ON FUNCTION public.finish_outbound_message(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_outbound_message(uuid, text, text)
  TO service_role;

-- Dashboard lookup for failed/in-flight human replies.
CREATE INDEX IF NOT EXISTS messages_human_failed_delivery_idx
  ON public.messages (chat_id, delivery_status)
  WHERE sender = 'human'
    AND delivery_status IN ('failed', 'sending');
