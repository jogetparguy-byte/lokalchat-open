# WhatsApp inbound content and customer identities

GAP-007 uses `persist_whatsapp_inbound` to save every supported customer event before HTTP acknowledgement. The webhook verifies each phone/account represented in an envelope before writing. Persistence failures return HTTP 500 so Meta can retry.

Text bodies, quick-reply button text, and interactive button/list titles enter the existing durable recovery queue. Interactive response IDs remain metadata rather than model instructions. Images, audio, documents, video, stickers, contacts, locations, empty text and unknown content types become readable placeholder messages with their type and safe attachment metadata. They are immediately marked `done`, pause the bot and add an explicit human review note. Media bytes are not downloaded or interpreted; the Inbox placeholder does not imply transcription or image understanding.

Pausing uses the existing chat trigger to advance the bot epoch, invalidating older bot drafts. Replayed external message IDs do not re-pause a resumed chat, repeat a handoff note, or overwrite its newer preview. A distinct unresolved media message still requires human review even if it arrives late. The handoff here records the need in Inbox; guaranteed owner alerts remain GAP-009.

## Identity contract

The normalizer accepts phone `messages[].from` and business-scoped user ID `messages[].from_user_id`; profile names match `contacts[].wa_id` or `contacts[].user_id`. A BSUID has a two-letter uppercase country prefix, a period, and up to 128 alphanumeric characters. It is preserved exactly, never phone-formatted. Parent BSUID-only payloads and username-only identities without a regular BSUID are not implemented; malformed/unsupported identity returns a retryable failure rather than acknowledging a silently discarded message.

The account-scoped RPC attaches phone/BSUID aliases to one chat under an advisory transaction lock. Phone-hidden messages continue the same chat after an earlier message provided both aliases. Conflicting alias records fail explicitly for manual reconciliation. Account A and B never share chat identity even when a BSUID string matches.

The sender defaults to Graph API v21.0 and accepts a `WHATSAPP_GRAPH_VERSION` override. GAP-008 sends BSUIDs using Meta's `recipient` request property and phone recipients using `to`. BSUID outbound is disabled by default: operators must verify the configured API version and account capability, then set `WHATSAPP_BSUID_ENABLED=true`. Supported BSUID-only text and interactive messages remain durably recorded while disabled; attempted bot or human sends receive an explicit terminal delivery error. Account/version restrictions can still produce a visible provider error after enabling. No live Meta account has been verified by this change.

Official contract checked November 20, 2026: [Meta business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/), including the November 5 update. Usernames are rolling out gradually and Meta flags these contracts as subject to change.

## Service-window transaction

The webhook calls GAP-008 `providerEventTime` to validate the provider event timestamp. It passes that timestamp and verified provider phone ID into the inbound RPC. The RPC calls the existing `record_whatsapp_customer_event` inside the same transaction as queue insertion, after resolving customer aliases. Recovery can never see a newly queued turn before its service window update commits. Duplicate callbacks can repair/reaffirm the same trusted event time without changing chat epochs. System events, invalid timestamps and future timestamps never substitute server arrival time to open a window.

Apply all migrations before accepting webhook traffic. The GAP-007 migration installs a PL/pgSQL body that resolves the GAP-008 window function when invoked; GAP-008 migration must finish before invocation. Existing GAP-002 and GAP-003 migrations are prerequisites. No production migration or deployment was applied by this task.

## Verification

`node --test tests/whatsapp-inbound.test.mjs` covers normalization, media fallback, BSUID-only identity, signature rejection, all-account envelope verification, status-handler failure and atomic window arguments.

`LOKALCHAT_RECOVERY_DB_ENV=<local-private-env> node --test tests/whatsapp-inbound-sql.test.mjs` creates a disposable schema and verifies migration order, media completion, epoch preservation on duplicate callbacks, aliases, account isolation, restricted function grants and rollback if window persistence fails. The variable is optional; the SQL test skips without it. Use a local disposable database only.
