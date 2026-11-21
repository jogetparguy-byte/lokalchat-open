# WhatsApp delivery tracking

API acceptance is recorded separately from provider delivery. `delivery_status=sent` retains the existing queue meaning; `provider_delivery_status` distinguishes accepted, sent by Meta, delivered, read and failed. Inbox displays these states and sanitized provider error codes. Human retries remain explicit; asynchronous failure never schedules a second send automatically.

The sender returns `providerMessageId` and `providerPhoneNumberId`. `recordWhatsAppAcceptance` atomically binds these to an existing outgoing message after checking its business owner. Each retry keeps its previous provider mapping. Callbacks for an older attempt cannot change the current attempt's status. Weekly reports use `recordWhatsAppReportAcceptance` because the owner need not have an Inbox chat; the latest report's provider status and safe delivery error are stored on the profile.

The signed webhook calls `processWhatsAppStatuses` only after resolving and verifying its phone/account binding. The service-only database functions retain callbacks received before API acceptance is persisted. An advisory transaction lock serializes callbacks and acceptance for the same business, provider phone and wamid. Reconciliation is idempotent: read outranks delivered; delivered outranks failed; failed outranks sent. Timestamps do not override stronger delivery evidence. Unknown statuses and malformed IDs/timestamps are ignored. Numeric error codes are retained; arbitrary provider prose is excluded.

Apply `20261120032537_whatsapp_delivery_tracking.sql` with the other pending migrations before activating this code. Ordinary authenticated clients cannot insert provider events or forge acceptance. Callback storage failures return a webhook error for provider retry. Accepted requests whose API response lacks a provider ID remain accepted with unconfirmed customer delivery; they are never converted into retryable failures.

A process crash or database outage after provider acceptance but before durable registration remains an external side-effect boundary: exactly-once sending is not guaranteed. Automatic recovery of stale submissions still needs owner caution when the acceptance result is unknown. No live Meta delivery was tested in this task.

## Verification

- `node --import tsx --test tests/whatsapp-delivery.test.mjs`: sender identity, safe error handling and report binding.
- `LOKALCHAT_RECOVERY_DB_ENV=/path/to/private.env node --test tests/whatsapp-delivery-sql.test.mjs`: isolated local PostgreSQL schema; early events, duplicate events, status reordering, tenant/phone isolation, previous attempt callbacks, report failure and function privileges.
- Inbox rendering and multipart tests cover customer receipt labels and terminal 24-hour policy blocking later parts without queue retries.
