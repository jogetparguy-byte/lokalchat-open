# LLM provider settings

The business Settings page now includes a Provider AI form. It supports Google Gemini, DeepSeek, OpenAI and custom public HTTPS endpoints using OpenAI Chat Completions. Users supply a model ID with chat and tool calling support; no model availability is assumed.

The server authenticates each request through the existing Supabase auth middleware. Every signed-in user can inspect non-secret LLM configuration metadata and save their own provider credentials to the installation env file. No admin role, profile lookup, account promotion or admin assistance is required. These settings remain installation-wide: users sharing one server use the same saved provider configuration. Saved API keys are never returned to the browser. This implements the user's explicit open-source self-service requirement and supersedes the earlier admin-only assumption.

Saving updates `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` and `AI_CONFIG_SOURCE=env` in the server-selected `LOKALCHAT_ENV_FILE` or `.env`. Automatic local setup uses `.lokalchat/local.env`; its launcher now preserves these values when refreshing database credentials. Configuration is re-read for subsequent AI requests and takes precedence over legacy database platform keys. The legacy admin screen links to Settings and explains the precedence.

Writes use an exclusive lock and an atomic rename with a private temporary file, mode `0600` on POSIX. The writer preserves unrelated assignments and comments, handles multiline values and duplicate LLM assignments, rejects symlink paths, and never accepts an env path from the browser. Responses contain only non-secret metadata. Empty keys retain the existing secret only when the selected provider and endpoint match. Custom endpoints undergo the existing public-URL check on save and at request time; AI requests reject redirects.

The form follows the existing Settings typography, palette, width and spacing. It uses labelled inputs, a masked key with a show/hide button and entry placeholder, loading, success, retry and error states. Successful saves clear and mask the key again. Completed mutations are reset with immediate garbage collection to avoid retaining submitted keys in the mutation cache. No new visual direction was drawn because this is a section within an established screen. No invented product data or new dependencies were added.

Validation:

- TypeScript typecheck passed.
- Full application `npm test` passed; the final LLM suite includes 13 tests covering validation, actual filesystem persistence, unrelated settings, key retention, current runtime configuration, custom paths, symlinks, locking, database precedence, authorization and server rendering.
- The local setup suite includes a restart test proving LLM configuration survives refreshed database credentials.
- Production build passed, with existing inputValidator deprecation and module directive warnings.
- Frontend source lint passed for the new section, using its app-screen `data-ui` boundary.
- Graphify was updated with the AST-only command.
- Browser interactions and screenshots remain unverified. Starting the harness failed with `listen EPERM` on `127.0.0.1:5175`. Chromium was unavailable and downloading it failed with DNS `ENOTFOUND`; system Firefox exited with signal 139. Browser harness and interaction tests are checked in for an environment that permits them.

No real provider key was used, no paid inference request was made, and no credentials were logged. Persistence and authorization tests use disposable files and mocked auth/database boundaries. Saving validates configuration syntax; it does not verify provider authentication, credits, model access or tool compatibility. Writable persistent storage is required. Multiple machines require the same persistent configuration or a separate configuration distribution system.

These changes are in `/home/irsyad_b/lokalchat-open`. Existing downloaded installer tarballs and installed app copies were not replaced, and nothing was published or deployed.

Endpoint references: [Gemini OpenAI compatibility](https://aistudio.google.com/docs/openai), [DeepSeek API](https://api-docs.deepseek.com/), [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat).

User self-service validation: all 13 LLM tests pass, including ordinary-user and missing-profile access without role queries, actual auth middleware rejection of missing login and invalid tokens, validation/SSRF checks, file persistence and enabled frontend controls. All 11 Supabase-settings tests pass, confirming their separate permission checks still work. Browser tests now include a complete ordinary-user save flow, but browser execution remains unverified because the harness cannot bind its port in this sandbox (`listen EPERM`).

The installed copy at `/home/irsyad_b/Downloads/my-lokalchat-native` does not contain `LlmSettingsSection.tsx`. Only the development repository was changed; installed copies and existing installer tarballs were not replaced. No credentials, database changes, publishing or deployment were involved.
