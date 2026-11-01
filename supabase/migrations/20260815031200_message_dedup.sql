-- Run once in Supabase SQL Editor. Existing messages remain unchanged.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS external_message_id text;

-- Only one copy of each provider message per chat. NULL values are allowed
-- so the dashboard simulator can continue working without a provider ID.
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_external_message_unique
  ON public.messages (chat_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
