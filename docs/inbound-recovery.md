# Inbound crash recovery

WhatsApp text webhooks now acknowledge only after the customer message is persisted. Duplicate inserts keep the original job. AI and outbound delivery run in the Node server's recovery loop, including after a restart with no new HTTP requests.

Apply `20261117060000_inbound_recovery.sql` after earlier migrations, then build and restart the Node server with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The worker starts at server module initialization and polls every 15 seconds. No external cron is required. This lifecycle requires a continuously running Node process; request-only/serverless deployments need an external persistent worker instead.

Each sweep selects at most 20 pending, failed (one-minute backoff), or expired processing messages (ten-minute lease). The existing atomic inbound claim rejects competing workers. At eight attempts, automatic recovery stops and the message remains failed. Older completed messages are excluded. Recovery uses saved reply parts and skips parts already marked sent; dry-run is disabled. Recovery reads current chat bot state before generating a new answer.

## Operations

Check server logs for `Inbound recovery sweep failed` (database/migration/configuration failure) and `Inbound recovery attempt failed` (message ID only). Use an operator database session to inspect outstanding jobs:

```sql
SELECT id, chat_id, external_message_id, processing_status,
       processing_attempts, processing_started_at, processed_at
FROM public.messages
WHERE sender = 'customer' AND external_message_id IS NOT NULL
  AND processing_status <> 'done'
ORDER BY created_at;
```

For an exhausted job, investigate linked bot parts' `last_delivery_error` and server logs. After fixing the cause and checking whether WhatsApp already received the reply, explicitly requeue only the intended message:

```sql
UPDATE public.messages
SET processing_attempts = 0, processing_status = 'pending'
WHERE id = '<message UUID>' AND sender = 'customer'
  AND processing_status = 'failed' AND processing_attempts >= 8;
```

Do not clear linked replies or sent flags. They prevent resending known completed parts. RPCs are service-role only; the migration adds no public table access.

## Delivery limits and verification

This is at-least-once recovery, not exactly-once delivery. If WhatsApp accepts a message and the process dies before saving `sent`, recovery can resend that part after its outbound lease expires. An original worker that remains alive beyond lease expiry can overlap a reclaim; leases do not fence external provider side effects. These limits require provider idempotency or reconciliation to eliminate.

`tests/multi-response.test.mjs` covers queue persistence before AI, duplicates, saved-reply recovery, and provider acceptance before status persistence (including the expected duplicate). `tests/inbound-recovery.test.mjs` executes the worker with database/agent stubs. `tests/inbound-recovery-sql.test.mjs` runs the migration in a throwaway schema on an explicitly selected loopback PostgreSQL database; set `LOKALCHAT_RECOVERY_DB_ENV` to an env file containing `DB_URL`. It checks eligibility, claim exclusion, lease expiry, retry backoff, exhaustion, and RPC permissions. These are simulated crash points, not live WhatsApp fault injection.

## Chat ordering and takeover extension

The subsequent `20261117070000_chat_turns_and_handoff.sql` migration adds per-chat FIFO eligibility, attempt tokens, bot generations, cancellation, and simulator transport-policy persistence. Apply both migrations in order. See `chat-turns-and-handoff.md` for authorization boundaries and queued-message invalidation.
