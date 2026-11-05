# Supabase configuration in Settings

Implemented in `/home/irsyad_b/lokalchat-open` on 2026-11-03.

## Behavior

- Added **Settings → Supabase**, following the existing single-column Settings layout, components, spacing and theme. No redesign or new dependency.
- Fields: project URL, publishable/legacy anon key, secret/legacy service-role key. Keys use password inputs; saved credentials never return in read/save responses. Submitted credentials leave the React Query mutation cache after completion.
- Any authenticated user can read configuration metadata and save their installation's settings. The server handlers use the existing authentication middleware without an admin role or profile lookup. Missing login and invalid tokens are rejected before file access.
- The form explicitly explains that users can configure Supabase themselves, provides a link to the official API-key guide, and states that settings apply to all accounts on the same installation. Its form has an accessible name and exposes its saving state.
- Saves `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_CONFIG_SOURCE=settings` together. Modern `sb_secret_` keys use the existing server variable name; no server-client API migration required.
- Target is server-selected `LOKALCHAT_ENV_FILE`, otherwise root `.env`. Automatic setup uses `.lokalchat/local.env`. No client-controlled file path.
- Shared atomic env writer extracted from LLM storage. Both forms now use the same exclusive `.settings.lock`, preserving unrelated values/comments and preventing lost simultaneous updates. Private temporary files and output use mode `0600` on POSIX; symlinks rejected; credentials are never logged.
- Input validation rejects privileged keys in the public field, invalid legacy key roles, invalid URLs and env injection. HTTPS origins supported; HTTP limited to localhost/loopback. No connection request is made while saving, and decoded JWT claims are used only for format checks, never account authorization.
- Empty keys retain saved values only for the same project origin; changed origins require a complete new pair. Existing runtime process configuration remains unchanged by the handler.
- Supabase changes require dev restart (Vite may also restart when its env changes); production requires rebuilding and restarting using the same env. Existing process/hosting overrides must be aligned. A restart indicator compares saved settings with process settings; it does not prove a production browser bundle was rebuilt.
- Automatic launcher honors Settings-selected Supabase without overwriting it, starting a managed local database or running migrations against the selected project. In this mode `--check` is offline configuration checking only. Stop-only still handles the previously managed local database.

## Scope and access implications

Configuration is shared installation-wide. Per the user's instruction, users configure it themselves without an admin role or admin assistance. This is installation configuration rather than a separate backend per account. A new project must already contain LokalChat's schema, storage, Auth configuration and required accounts. Saving does not transfer data, create users/admins, validate keys, verify connectivity or apply migrations. Changing projects can require logging in again. Initial bootstrap and recovery from invalid credentials require local access to env because Settings itself requires a functioning login.

No real Supabase credentials, live database writes, paid requests, commits, publish, deployment or installer rebuild were performed. Old installer tarballs and installed copies are unchanged.

## Verification

Passed:

- `npm run typecheck`.
- Full `npm test`, including 11 new Supabase tests, 12 existing LLM tests and launcher tests (including preserving selected Supabase across restarts without database operations).
- `npm run build`; existing framework deprecation/module directive warnings remain.
- Real component SSR checks: labels, password fields, ordinary-user/loading states, restart and data notices. The current Supabase suite has 12 passing tests, including the real authentication middleware with a stubbed Auth service, users without an admin role/profile, invalid tokens and rejected privileged public keys.
- Design source lint: 0 failures, 0 warnings.
- `git diff --check`.
- Browser test script syntax check.
- `graphify update .`: 1288 nodes, 2673 edges; scoped query finds new settings/storage/launcher code.

Browser validation is pending: `npm run test:harness` fails with sandbox `listen EPERM` on `127.0.0.1:5175`; Chromium installation fails with DNS `ENOTFOUND cdn.playwright.dev`. Browser scenarios are supplied in `tests/supabase-settings-browser.mjs` for saving, pending/clear/cache, retained keys, changed project, wrong public key scope, errors, SME/read errors and widths 1440/768/390. No screenshots were produced or visually verified.

The optional static `scripts/audit-env.mjs` did not complete within 15 seconds; no pass is claimed for that audit. Typecheck, unit suites, production build and diff checks completed independently.

### Self-service follow-up verification

Rechecked the current code after the user's request to remove admin involvement. User access was already enabled in the working tree; this follow-up clarified the frontend guidance and corrected stale access documentation.

- `npm run test:supabase-settings`: 12 passed, 0 failed.
- `npm run test:llm-settings`: 13 passed, 0 failed.
- `npm run typecheck` and `npm run build`: passed. Existing framework deprecation, bundle-size and module-directive warnings remain.
- App source design lint: 0 failures, 0 warnings; `git diff --check` passed.
- `graphify update .`: completed, 1294 nodes and 2676 edges.
- Browser attempts remain blocked: harness returned `listen EPERM` on `127.0.0.1:5175`; the inspector found no Chrome/Edge/Chromium. No visual pass is claimed.

The existing LokalChat theme and single-column form layout were retained; no design draw or sample data was needed for this scoped component update. No new dependency, live credential change, database operation or installed-copy update was made.

## Documentation checked

Supabase changelog and API-key documentation were checked before implementation. No database schema or Supabase API signature changes were needed.

- https://supabase.com/changelog.md
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated
- https://supabase.com/docs/guides/getting-started/api-keys
