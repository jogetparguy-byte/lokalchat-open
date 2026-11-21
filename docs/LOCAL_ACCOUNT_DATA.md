# Local accounts and backend data

Local LokalChat accounts remain in the installation's private SQLite account database. Passwords and HttpOnly cookie sessions stay local. When the installation has a working Supabase backend, authenticated server operations bridge the local session to a dedicated backend Auth user with the same UUID.

## Identity and authorization

The installation UUID is generated once and persisted alongside the local accounts. Provisioning creates a backend Auth user with a server-generated synthetic email and trusted `app_metadata` containing both `lokalchat_installation_id` and `lokalchat_account_id`. Existing backend UUIDs or emails are never adopted unless the trusted binding matches. User-editable metadata cannot establish ownership.

The server uses the backend admin API only to provision and verify that identity and obtain a scoped session. Backend access tokens remain in server memory. Each data request uses a fresh publishable-key client authorized as the verified owner, so existing database and private Storage RLS policies continue to enforce ownership. The service-role key is never used as the account's data client or returned to the browser.

The local cookie takes precedence over any legacy hosted bearer session. An invalid local cookie fails closed. A request bound to another account is rejected using `x-lokalchat-account`; the header is a consistency check and never chooses the authorized owner. Mounted account views capture their owner so a stale form or upload cannot silently become a mutation for the replacement account.

Local logout revokes the SQLite session. Every later server request validates that session before using any cached backend token. The server also checks the local session after network provisioning, token exchange and profile synchronization. Backend tokens have no browser endpoint and are not a replacement login credential for the application.

## Installation setup

The server operator configures the installation backend with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, then applies the application's canonical migrations. Placeholder credentials or an unavailable backend leave accounts signed in with Settings available and data operations blocked. The readiness gate verifies provisioning and an owner-scoped profile write before opening the account's data pages.

A saved per-user Supabase connection profile or a Supabase MCP OAuth connection does not switch the installation backend. The MCP connection remains separate from application data authorization. Per-user backend selection requires a separate design and is not enabled by this bridge.

Same-UUID ownership preserves existing per-user AI settings and WhatsApp business ownership. Local `business_name`, `inventory_api_url` and `owner_whatsapp` synchronize to that owner's backend profile. Synchronization does not overwrite unrelated profile fields such as `system_prompt`. Local account preferences are copied to the matching backend Auth user's metadata; metadata never grants authorization or an admin role.

Knowledge base uploads travel through an authenticated server function. The server derives both the Storage folder and document owner from the verified identity. Clients cannot supply a replacement user ID or Storage path. Uploads and document metadata use the same scoped RLS session.

## Verification

- `npm run test:account` includes bridge tests for distinct owners, concurrent provisioning, trusted binding collisions, stale owner headers, revoked sessions, logout during provisioning, profile preservation and unavailable configuration.
- `tests/local-account-live.test.mjs` is the independent disposable-backend verification harness. It must use a private test environment and isolated account database, never the desktop account database or an unapproved hosted project.
- Production build and browser/RPC checks are separate validation steps; unit tests alone do not prove RLS or Storage behavior.

This change does not resolve the other critical gaps: message queue recovery, chat concurrency, System Prompt consumption, business fact enforcement, delivery receipts, media handling, templates or handoff alerts.
