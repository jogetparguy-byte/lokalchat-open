# Per-account environment configuration

The user requested that LokalChat users supply their own configuration and never share a writable installation `.env`.

## Implemented

- Settings reads and writes use the verified Auth account ID, never a request-supplied user ID or file path.
- Files live at `.lokalchat/users/<SHA-256 of Auth project URL>/<user UUID>/.env`. `LOKALCHAT_USER_ENV_DIR` changes only the private storage root. Account directories use mode `0700`; new/replaced env files use `0600` on POSIX.
- LLM and Supabase writers share an exclusive lock for one account, preserve unrelated fields and replace files atomically. Different accounts use different files and locks. Symlink paths are rejected.
- LLM settings no longer read or retain keys from the process environment, installation env or another account. The active agent resolves the persisted chat owner's key, including simulator and WhatsApp ingestion. Legacy platform keys cannot fund tenant requests.
- Optional OpenAI embeddings use the owner's saved OpenAI provider key. Global `OPENAI_API_KEY` is ignored. Other providers use keyword fallback.
- Settings summaries return configuration status, never persisted key values. Blank keys retain only that owner's keys at the same provider/endpoint or project URL.
- Authenticated dashboard queries get an account-specific QueryClient subtree. Account changes discard previous form state and caches, including late results. Stale Auth checks cannot restore a session after sign-out.
- Existing global credentials are not copied to users because no trusted ownership mapping exists. Every user must enter their own AI key.

## Supabase decision still pending

The async clarification asks whether each account needs its own Supabase project or whether one project with RLS is intended. This determines authentication, project routing and background-job handling.

Supabase Settings now stores a private per-account connection profile only. It does not activate that project's database, change the global Auth/data clients, rewrite the operator bootstrap env or require a global restart. The form and installation docs explicitly explain this limitation. Login, business data, Storage and scheduled jobs still use the installation project with existing RLS. Per-user Supabase runtime routing has not been implemented while this decision is pending. Data was not migrated, and no live database was modified.

The operator bootstrap env still configures shared installation infrastructure. This is separate from private per-account configuration. Filesystem operators can read plaintext `.env` credentials; these files are not an encrypted secret manager. Persistent storage is required, and multiple app servers require storage supporting exclusive creation and atomic rename.

## Validation

- `npm test`: passed, including six new multi-account isolation/security tests and existing authenticated Settings, delivery, upload, theme and setup checks.
- `npm run typecheck`: passed.
- `npm run build`: passed, with existing TanStack `inputValidator` and bundler warnings.
- `git diff --check`: passed.
- `graphify update .`: passed; rebuilt 1,404 nodes / 3,055 edges.
- After adding an assertion that the real agent passes the persisted owner to key resolution, `tests/settings.test.mjs` was rerun.
- Live provider keys, live database/RLS integration and browser account switching were not exercised in this environment. Unit/handler tests use fixtures. No deployment or npm publication was performed.

Relevant Supabase references checked: [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [API keys](https://supabase.com/docs/guides/getting-started/api-keys). The changelog markdown endpoint could not be fetched by the web tool (unsupported content type); no Supabase SDK API or schema change was made.
