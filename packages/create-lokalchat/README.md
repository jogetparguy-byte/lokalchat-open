# create-lokalchat

Create a self-hosted LokalChat Open app. Requires Node.js >=22.12 (Node 24 LTS recommended).

```sh
npx create-lokalchat@latest my-lokalchat
cd my-lokalchat
```

Follow the generated README to configure a **new local/development Supabase project**, apply database migrations and fill `.env`, then run `npm run dev`. The CLI installs development dependencies, including Vite, by default. It does not connect to Supabase, run migrations, initialize Git or copy credentials. `.env` starts with placeholders only. Existing nonempty directories are refused.

Options: `--package-manager npm|pnpm` (default npm), `--skip-install`, `--help`, `--version`.

Maintainers: run `npm test` and `npm pack --dry-run` in this directory. `prepack` builds the bundled app template from an explicit source allowlist and runs CLI tests. Regenerate the template after changes to the application. Review the package contents before an authorized npm publication; preparing a package does not publish it.
