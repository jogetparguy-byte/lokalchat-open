# Chat turns and human takeover

Apply `20261117070000_chat_turns_and_handoff.sql` after the inbound recovery migration, build, and restart the continuously running Node server. Runtime backend configuration remains a prerequisite. No migration has been applied to the main application's backend during this implementation.

## Processing order

Accepted customer messages form a durable per-chat queue, ordered by database `created_at`, then UUID `id` for equal timestamps. This is server acceptance order, not a guarantee of the customer's original WhatsApp send order. Inbound claims lock the chat row for the short SQL transaction and permit only the oldest unfinished turn. A failed turn holds later turns through backoff. After eight attempts, an exhausted failed turn is skipped so other messages can proceed. Separate chats can claim independently. The current Node recovery sweep processes its batch sequentially.

Each claim receives a new UUID processing token. Outbound authorization and inbound completion require that token. A worker that resumes after its lease expired cannot authorize a new send, initiate handoff, or finish the replacement attempt. An already authorized provider call remains outside this database fence. Recovery reuses the persisted reply batch; it does not regenerate a batch already saved.

Simulator messages now also receive an external UUID and use this durable queue/claim path. Their `allow_dry_run` transport flag is saved and carried through recovery. A simulator request that cannot claim immediately returns no immediate bot reply; the recovery worker handles it later.

Model history includes completed customer turns, the current turn, and sent bot/human messages. Later queued customer messages and unsent/cancelled bot drafts are excluded.

## Pause, resume, and handoff

A database trigger increments `chats.bot_generation` on every explicit update of `is_bot_active`, including repeated manual pause. Draft answers and accepted inbound jobs retain their generation. Jobs queued under an earlier generation are consumed without a new answer after a state change. Existing customer jobs are assigned the current generation during migration so their crash recovery remains available.

The agent checks current generation after model execution and before saving its reply. Each individual outbound part then passes a SQL authorization check under the same chat lock used by pause/resume. Answers require a matching generation and an active bot. Old persisted retries become `cancelled`, and Inbox displays a cancellation label without offering a bot retry. Legacy unversioned bot drafts also cancel rather than sending after migration.

AI handoff uses a compare-and-set RPC requiring the current generation and processing token. It pauses the chat and receives the new generation. Only its explicitly tagged `handoff` confirmation may send while paused at that generation. Old sales replies cannot gain this exception. A subsequent manual pause or resume invalidates the confirmation too.

## Limits

Pause cannot retract an outbound request already authorized and started. A part in flight may finish after takeover. Each later part is checked separately and is suppressed. There is a small unavoidable interval between database authorization and invoking the external provider; this is the authorization boundary, not a guarantee that no network request can start after the pause response. No distributed transaction spans PostgreSQL and WhatsApp.

Crash after provider acceptance but before recording `sent` can still duplicate that part, as documented in `inbound-recovery.md`. Expired workers may finish their model computation, but their stale tokens cannot authorize subsequent sends or handoffs. No live WhatsApp race or physical process-kill test was run.

## Verification

- `tests/multi-response.test.mjs`: pause during model execution, pause/resume, pause after draft persistence, pause between parts, old persisted retry, stale AI handoff, and valid handoff behavior.
- `tests/chat-turns-sql.test.mjs`: actual PostgreSQL migration and concurrent claim calls, independent chats, history scoping, attempt tokens, manual generation changes, handoff exception, legacy cancellation, queued epoch invalidation, and RPC access denial to anon.
- `tests/settings.test.mjs`: existing language test updated for the new history RPC and chat state reads.

Set `LOKALCHAT_RECOVERY_DB_ENV` to an env file containing a loopback `DB_URL` to run SQL tests. Normal `npm test` skips the two database tests unless this variable is supplied. All SQL tests write only to throwaway schemas on the explicitly selected loopback database.
