# Multiple customer replies

The customer agent can send one to three separate messages for one incoming customer message. It uses the existing owner-selected provider and model. Simple answers can stay as one message; a promotion or ordering question is optional.

The hardcoded `respond_to_customer` tool accepts an ordered `messages` array. Its description asks the model to separate useful points only and to finish business-data lookups first. The server validates the array, rejects empty, duplicate or oversized parts, and enforces a maximum of three messages. A normal plain-text completion remains one message, even if it contains paragraphs or numbered steps. Providers must support the existing OpenAI-compatible function-calling interface to select multipart replies.

The server validates structure, not the truth of generated text. Prices and promotions still depend on the business knowledge base and the model using its lookup tools correctly. No price or discount is added automatically by the application.

The complete batch is inserted atomically before sending. Each part has its own delivery status and sequence. WhatsApp submissions run in order; a failed or busy part blocks later parts. On a webhook retry, the agent reuses the stored batch and skips parts already marked sent. As with the previous transport, a crash after provider acceptance but before recording success can still result in a duplicate submission; this is not an exactly-once delivery guarantee. Provider acceptance also does not establish customer receipt or read status.

## Database rollout

Apply `supabase/migrations/20261115021920_multi_response_messages.sql` using the existing database migration workflow **before starting this updated backend**. It adds `messages.reply_sequence` and changes inbound-reply uniqueness to include the part number. Existing replies default to sequence zero. Both history and Inbox queries use the sequence to preserve order when batch timestamps match. The migration leaves the existing account ownership and RLS policies in place.

The instruction Markdown file is not changed or loaded by this feature. No customer-facing model selector is added.

## Verification

- `npm run test:multi-response`: actual agent orchestration with mocked gateway, database and WhatsApp transport. Covers optional single replies, lookup-before-reply, strict validation, retry/resume, delivery leases, persistence failure, handoff and simulator delivery.
- `node --test tests/backend-delivery.test.mjs`: includes Inbox ordering when timestamps match and message IDs sort differently.
- `tests/disposable-schema.sql`: includes actual database checks for three linked parts, duplicate sequences and the sequence limit, for the existing disposable Supabase test runner.
- `npm test`, `npm run typecheck`, `npm run build`.

Development verification also applied the migration to an isolated PostgreSQL/PGlite database and checked preservation of historical rows, uniqueness, sequence bounds, chat scoping and atomic rollback. No hosted migration, real LLM request or real WhatsApp send was performed.
