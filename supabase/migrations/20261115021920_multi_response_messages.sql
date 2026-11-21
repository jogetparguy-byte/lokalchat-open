BEGIN;

-- Historical replies remain the first (and only) part of their batch.
ALTER TABLE public.messages
  ADD COLUMN reply_sequence smallint NOT NULL DEFAULT 0
  CONSTRAINT messages_reply_sequence_check CHECK (reply_sequence BETWEEN 0 AND 2);

-- The whole batch is inserted in one statement; retries reuse these rows.
-- The existing index name is retained so duplicate-part guarantees stay explicit.
DROP INDEX public.messages_reply_to_external_unique;
CREATE UNIQUE INDEX messages_reply_to_external_unique
  ON public.messages (chat_id, reply_to_external_message_id, reply_sequence)
  WHERE reply_to_external_message_id IS NOT NULL;

COMMIT;
