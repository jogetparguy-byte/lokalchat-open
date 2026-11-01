-- Repeated HTTP submissions reconcile one stored human reply per chat.
-- Existing rows keep NULL and preserve their current delivery behavior.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS messages_human_client_request_unique
  ON public.messages (chat_id, client_request_id)
  WHERE sender = 'human' AND client_request_id IS NOT NULL;
