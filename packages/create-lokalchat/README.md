# create-lokalchat

Create a self-hosted LokalChat Open app. Requires Node.js 22.13+ or >=24 (Node 23 is unsupported; Node 24 LTS recommended).

```sh
npx create-lokalchat@latest
cd lokalchat-app
npm run setup:local
```

The default folder is `lokalchat-app`. To choose a folder, use `npx create-lokalchat@latest my-lokalchat`. The command creates the app and installs dependencies; run `setup:local` afterwards when ready to start local services.

`setup:local` downloads pinned Supabase CLI 3.0.0 from its official release and verifies its SHA-256 checksum. It starts a separate development database, applies bundled migrations, verifies migration history, Auth and REST, saves private local settings, then starts the app at **http://127.0.0.1:3000**. Keep the terminal open. Ctrl+C stops the app and this database without deleting data; run `setup:local` again to resume. First setup needs internet and can take several minutes. Each setup command/health request has a 15-minute limit. There are no automatic retries.

For setup immediately after dependency installation:

```sh
npx create-lokalchat@latest my-lokalchat --setup-local
```

Local setup uses **experimental Supabase stacks**. Runtime `auto` selects a responding Docker/Podman engine or native services on supported systems. Native requires Linux glibc 2.35+ (x64/arm64) or macOS 14+ on Apple silicon. Windows and Intel Mac require a running Docker/Podman engine. To select native explicitly: `npm run setup:local -- --runtime native`. The saved runtime is reused; switching requires a new app folder. Native is intended for one running project per environment. At least 1.5 GB free disk is checked; service downloads/container images may need more. This is for development, not production deployment.

Private configuration, database state, CLI cache and logs live in Git-ignored `.lokalchat/`. The app's `.env` and original `supabase/config.toml` are preserved. Automatic setup refuses custom `.env`/`.env.*` files: use a fresh folder. Email confirmation is disabled only in this separate local config. No default user/admin account is created. WhatsApp and AI need separate configuration. Do not share `.lokalchat/local.env` or `setup-private.log`.

For a **new hosted development project**, follow generated `docs/INSTALL.md` and configure `.env` manually. Scaffolding itself never connects to a database, runs migrations, initializes Git or copies credentials. Dependencies include Vite. Existing nonempty directories are refused. Failed/cancelled dependency installation keeps the project and prints a resume command.

Installer options: `--package-manager npm|pnpm` (default npm), `--skip-install`, `--setup-local` (requires installation), `--completions bash|zsh|fish`, `--help`, `--version`. Completion output is for the standalone `create-lokalchat` command and can be loaded through your shell's usual completion configuration.

Generated app commands:

- `npm run setup:local`: prepare/resume local development and start the app.
- `npm run setup:local -- --check`: prepare and verify, then stop without starting the app.
- `npm run stop:local`: stop this database after an interrupted launcher exits; keep data.
- `npm run setup:local -- --help`: show runtime options without downloads.

Use `pnpm run` instead of `npm run` if preferred. With pnpm, pass script flags directly: `pnpm run setup:local --runtime native`.

Maintainers: run `npm test` and `npm pack --dry-run` in this directory. `prepack` builds the bundled app template from an explicit source allowlist and runs CLI tests. Regenerate the template after changes to the application. Review the package contents before an authorized npm publication; preparing a package does not publish it.

After packing, run `npm run test:package -- /absolute/path/create-lokalchat-0.2.0.tgz`. This runs the actual tarball through `npm exec` (the executor behind `npx`) using an isolated offline cache. It checks help/version, shell completions, default and named scaffolds, private placeholder configuration and refusal to overwrite existing files. It does not install app dependencies or start services. Publish the same reviewed tarball; see `docs/RELEASING.md`.

The public `@latest` command is available only after npm publication. For local testing before release, see `docs/RELEASING.md` in the source repository.
