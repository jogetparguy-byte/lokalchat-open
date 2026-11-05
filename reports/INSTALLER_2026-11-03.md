# Installer verification — 2026-11-03

Working repository: `/home/irsyad_b/lokalchat-open`. Existing application changes were preserved. No Git commit, GitHub push, npm publication, live database migration or provider setup was performed.

## Result

Local installer artifact: `/home/irsyad_b/Downloads/create-lokalchat-0.1.1.tgz`.

SHA-256: `d5f142d04ab57126137ebfa47f6782795dd9068e058a24488a5c848628766b71`.

The user completed installation and verification of the security candidate from their ordinary terminal. The supplied screenshot reports a successful build, `found 0 vulnerabilities`, and successful completion of the verification script. That script uses `set -e` and runs dependency installation, pnpm lockfile generation, Drizzle CLI startup, dependency compatibility checks, the 34 application tests, typecheck, build and npm audit in sequence. This establishes the candidate checks completed; it does not exercise live application integrations.

The application's source/config/tests were compared against that candidate before promotion and matched. Only dependency settings, runtime requirements, installer packaging and a dependency compatibility test were subsequently changed.

## Changes

- Upgrade direct Zod to ^4.6.7.
- Upgrade ESLint to ^10.14.0, @eslint/js to ^10.0.1, React Hooks plugin to ^7.1.1, React Refresh plugin to ^0.5.7 and TypeScript ESLint to ^8.72.1.
- Override only minimatch 10.x to 11.0.4 and the legacy @esbuild-kit/core-utils esbuild dependency to 0.25.12, in both npm and pnpm settings. Avoid replacing minimatch 3.x under old ESLint with an incompatible function export.
- Preserve the candidate's targeted pnpm release-age exception for the reviewed minimatch 11.0.4 version. The exemption does not apply to other packages or versions.
- Require Node 22.13+ on the 22.x line, or Node >=24. Node 23 is unsupported by the updated ESLint engine range. Update CLI validation, package engines and installation documentation accordingly.
- Bundle both npm and pnpm lockfiles. Normalize npm lockfile root names when creating a project without changing dependency entries.
- Keep asynchronous installation and Ctrl+C handling from the earlier installer work. Preserve files and give a resume command when installation fails or is cancelled.
- Retain the optional HARNESS_URL documentation added after the packed environment audit exposed its omission.
- Increment installer version to 0.1.1. Version 0.1.0 remains the older artifact with the reported vulnerabilities.

## Final packed-artifact checks

- Installer tests: 13 passed, 0 failed, 1 skipped. The existing npm-style symlink subprocess test is skipped because this session returns EPERM. Direct packed entrypoint execution, help, version and scaffold generation passed.
- Archive path/type audit: 180 entries; no path traversal, symlinks, private .env files, Git, node_modules, build outputs, reports or Supabase runtime/link state.
- The actual packed CLI generated `/tmp/lokalchat-release-011-dkdetd72/app`; its normalized package names and all npm locked dependency records matched the intended artifact.
- Full offline npm ci hit this session's EPERM restriction during the esbuild postinstall binary check. A subsequent offline npm ci with lifecycle scripts disabled passed, installing 428 packages from cache. This is distinct from the user's successful ordinary-terminal install, which ran the standard install path.
- Using those newly installed dependencies in the final packed app: all 34 application tests passed, dependency compatibility checks passed, typecheck passed, production build passed, and the environment audit passed for 24 referenced variables plus 2 framework controls. No node_modules symlink was used.
- pnpm lockfile importer specifiers and overrides match the manifest/workspace settings. Affected package entries are Zod 4.6.7, minimatch 11.0.4 and esbuild 0.25.12/0.28.2. This session could not execute a fresh pnpm frozen-lockfile check because its store operation lock path is read-only, including with an explicit temporary store; no further retries were made.
- Build emitted module-level `use client` directive warnings and completed successfully. No warning suppression was added.
- Graphify updated locally. git diff --check passed.

## Remaining release gates

- Windows/macOS execution and full process-tree cancellation on those systems remain unverified. Windows command construction and cancellation result handling have unit coverage.
- Login, database, WhatsApp and AI integrations were not exercised here. Generated projects still require their own Supabase configuration and migrations.
- The original working checkout and the user's earlier `lokalchat-installer-check` node_modules were not replaced; the successful dependency tests ran in the separate candidate and final extracted artifact. Use the updated lockfile when refreshing those installations.
- npm name ownership, maintainer authentication/2FA and publication remain to be verified. The release guide requires explicit permission before npm publication. Nothing has been published or pushed.
