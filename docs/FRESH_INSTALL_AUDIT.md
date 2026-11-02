# Fresh install verification

Verified on 2026-11-02 with Linux, Node 24.21.0, npm 11.19.0 and pnpm 12.11.2. All generated projects used placeholder environment files. No production database, provider account, or existing credentials were used.

## Results

| Check | Result |
| --- | --- |
| Build bundled CLI template and local npm tarball | PASS |
| Run actual npm bin via `npm exec --offline --package <local-tarball> -- create-lokalchat <new-directory> --skip-install` | PASS |
| Generated `.env` mode `0600`, ignored private env paths, no `.git` or Supabase link state | PASS |
| Generated environment source audit | PASS: 23 referenced variables documented |
| Generated `setup:check` on placeholders | Expected failure: names only, no credential values printed |
| `pnpm install --frozen-lockfile --prod=false` in clean generated project | PASS: 433 packages; 575 lockfile entries passed policy verification |
| `npm run build` after fresh pnpm install | PASS: Vite 8.3.5 client and Nitro Node server artifacts |
| `npm run typecheck` | PASS |
| `npm test` including final setup validator tests | PASS: 33 tests |
| Fresh generated development server on localhost | PASS: HTTP 200; server stopped after check |
| Missing dependencies and `npm run dev` | Expected actionable message to install development dependencies |
| Repository dependency install and tests (independent parent verification) | PASS: frozen pnpm install, typecheck and 33 tests |

The temporary verification directory was `/tmp/lokalchat-fresh-8iRdsU`. `app` contains the installed and built pnpm project. `packed-app` was created through the real packed npm executable. The final setup validator and package test script were copied into the first generated project before its final 33-test and typecheck verification.

## Limits and follow-up

- This verifies a local packed package; the public npm `create-lokalchat@latest` release still requires publication and registry verification. Nothing was published or pushed.
- The default npm installation was started, but npm spent over nine minutes resolving optional peer dependency metadata. It was stopped after 841 log lines, with successful registry responses and no installation error; the last pending metadata request was `kysely@*`. A separate frozen-lockfile pnpm install completed successfully. Do not interpret the pnpm result as proof that the full default npm installation completed.
- Restricted sandbox DNS initially prevented registry access. Registry requests succeeded with approved network access. The offline pnpm fallback could not resolve uncached `@oozcitak/infra` metadata; the online frozen install succeeded.
- Builds emit existing upstream deprecation and bundling warnings: TanStack `inputValidator`, `vite-tsconfig-paths`, and dependency `use client` directives. They do not fail the build.
- Supabase migrations, RLS, storage, authentication, WhatsApp and AI integrations require separate local/disposable-project integration verification. No remote migration or production action was run during this dependency/build audit.
