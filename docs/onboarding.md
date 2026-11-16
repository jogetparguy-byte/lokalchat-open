# Account onboarding

`/auth` opens account creation with seven English questions, one per screen: name, company, team size, intended use, referral source, email, and password. Existing users can choose Sign in. Signed-in users go to `/dashboard`.

Back keeps answers in component memory. Switching between registration and sign-in clears the password. Refreshing clears the unfinished form. No draft or password is persisted in browser storage.

The final action creates the account through the existing `/api/account` endpoint. The local SQLite account metadata stores `full_name`, `team_size`, `use_case`, and `referral_source` alongside `business_name`. The server validates the new fields and discards unrelated metadata. Older clients can still register without an onboarding payload. Password hashing and session cookies use the existing account store; no database migration is needed.

The layout uses the existing logo, type, theme tokens and green accent. The auth header contains the logo without a theme switch. A narrow question column and seven progress segments keep attention on the current question. Native inputs and radio groups support keyboard navigation. Continue and Back fade the old question out over 160 ms before revealing the next over 220 ms, using opacity only. The question is inert during the transition, duplicate submissions are ignored, and input focus resumes after the reveal. Reduced motion skips the fade. No decorative motion. Design dials: ENERGY 1 / RHYTHM 1 / MOTION 1. The form has English language semantics inside the existing app shell.

Validation performed on 15 November 2026:

- Full `npm test`, typecheck, production build, and theme SSR checks passed.
- Two new onboarding tests cover invalid payloads, metadata filtering, atomic registration, persistence across login, account separation, and absence of plaintext passwords.
- Browser walkthrough completed account creation and returning-user login using an isolated SQLite database. Back retained answers; invalid email was blocked; password visibility worked; mobile width 390px had no horizontal overflow. Light and dark screenshots inspected.
- Local `npm pack` passed installer tests and bundled matching copies of all five onboarding source files. Package not published.
- Existing Fedora service restarted with the new build. `/auth` returned HTTP 200.

Validation performed on 16 November 2026: production build and typecheck passed. Browser checks confirmed fade-out/fade-in ordering, intermediate opacity, duplicate-submit protection, retained answers on Back, restored focus, and no animation with reduced motion enabled. The desktop service was restarted with the updated build.

This changes account setup only. Connecting local account identities to the runtime backend remains separate pending work.
