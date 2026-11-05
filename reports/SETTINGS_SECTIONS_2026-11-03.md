# LokalChat settings sections

Implemented in `/home/irsyad_b/lokalchat-open` on 3 November 2026.

## Result

Settings now uses the existing dashboard shell, with a dedicated section menu on desktop and a section selector below 700px. It keeps the existing logo, typography, theme tokens and navigation behavior. The content grid is 208px navigation + 40px gap + remaining content, capped at 1120px. No generated imagery or sample product data was added.

Seven settings areas plus a help area:

- **General:** business name, saved independently.
- **Appearance:** light/dark theme preview and dashboard sidebar preference, saved in the browser. The toolbar theme control remains available.
- **Language & region:** BM/English interface preference, time zone and date format, saved in the browser. Translation covers Settings, dashboard, inbox, knowledge base, FAQs, setup checklist, unanswered questions and dashboard navigation. Customer messages, uploaded content and prompts remain as authored. Auth/admin pages and backend-generated error messages do not have a complete translation catalog.
- **AI reply language:** a separate account preference under Language & region. The agent reads the verified business owner's preference and adds a constrained language instruction to the gateway prompt. Explicit English also applies to handoff/error fallback replies.
- **Configuration:** existing AI-provider and Supabase forms remain self-service for signed-in users, with their installation-wide scope visible. Configuration drafts survive refetches and section changes; secrets are cleared after successful saves.
- **Integrations:** existing WhatsApp connection form, bilingual webhook guide, and inventory API URL.
- **Notifications:** weekly report opt-in/out, separate report-recipient form. The weekly hook checks opt-out before sending and skips accounts whose preferences cannot be read. Delivery uses the existing server job; display time zone does not reschedule it. New notification types and custom delivery schedules are not implemented.
- **Account & security:** signed-in email and last sign-in, editable display name, password change with confirmation, optional current password and reauthentication code, sign-out of other sessions or all sessions with confirmation. Normal sidebar sign-out now uses the local scope. The account card follows Auth user updates.
- **About & help:** configured `VITE_APP_VERSION` when supplied (otherwise a truthful local-build label), build mode, installation guide, issue link and inline help.

Account-only preferences use top-level user metadata keys `lokalchat_reply_language` and `lokalchat_weekly_report`. They are never used for authorization. No schema migration is needed. Auth operations use the signed-in browser client; no admin credentials enter the browser. The session behavior follows [Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout); existing access tokens may remain usable until expiry. Password updates support [Supabase reauthentication and current-password requirements](https://supabase.com/docs/guides/auth/password-security).

Each form saves only its own fields. The profile server handler validates partial updates, retains tenant filtering and the existing inventory SSRF check. Switching sections warns about unsaved work and retains the draft; router navigation and browser unload warn before discarding it. Panels mount on first visit and remain mounted while Settings is open. Existing `#llm`, `#supabase` and `#whatsapp` entry links select the correct section.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 103 reported tests across the existing suites and eight new settings tests.
- New tests verify partial profile validation and server isolation, persistence/corrupt/blocked storage, cross-tab synchronization, time-zone/date formatting, constrained account preferences, real agent gateway instructions and weekly report opt-out/error handling.
- `npm run build`: passed. Existing bundle-size, framework configuration and module-directive warnings remain.
- Taste source lint on six settings sources/styles: 0 failures, 0 warnings.
- `git diff --check`: passed.
- Happy DOM integration at `/tmp/lokalchat-settings-dom-check.mjs`: passed five groups covering actual Settings components with mocked API/Auth/router boundaries: navigation/lazy panels/dirty warnings/draft retention/partial save; persistent English UI/configuration translation/AI language; theme and report preference; account/password validation/failure/retry/clearing/session confirmation; help and mobile selector.
- Existing sidebar Happy DOM check rerun: all eight groups passed.
- Native browser rendering, responsive geometry, real focus/inert behavior and screenshots remain unverified. Vite harness failed with `listen EPERM` at `127.0.0.1:5175`; Playwright Chromium is not installed. No visual score is claimed.
- Real account/password/session mutations and report delivery were not exercised against the user's live services. Integration boundaries were mocked; no real credentials or database records were changed during verification.
- `graphify update .`: passed with automatic sequential fallback, 1395 nodes and 3025 edges.

No deployment or npm publication was performed.
