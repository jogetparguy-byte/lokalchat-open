import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTemplateSafe } from '../bin/create-lokalchat.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const template = join(packageRoot, 'template');
// Explicit allowlist: never package local env files, Git history, Supabase link
// state, reports, backups, credentials, dependencies, or build artifacts.
const allowed = ['src', 'public', 'scripts', 'tests', 'docs', 'supabase/migrations', 'supabase/config.toml', 'drizzle', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'tsconfig.json', '.env.example', 'README.md', 'LICENSE'];
// Fail before deleting/copying the template if source trees contain any links.
for (const item of [...allowed, '.gitignore']) await assertTemplateSafe(join(root, item));
await rm(template, { recursive: true, force: true });
await mkdir(template, { recursive: true });
for (const item of allowed) {
  await cp(join(root, item), join(template, item), {
    recursive: true,
    filter: source => {
      const parts = relative(root, source).split('/');
      return !parts.some(part => ['node_modules', '.git', '.lokalchat', '.supabase', '.temp', '.branches', '.output', 'dist'].includes(part) || (part.startsWith('.env') && part !== '.env.example') || part.endsWith('.log'));
    },
  });
}
await cp(join(root, '.gitignore'), join(template, 'gitignore'));
const configPath = join(template, 'supabase/config.toml');
await writeFile(configPath, (await readFile(configPath, 'utf8')).replace(/^project_id\s*=.*$/m, 'project_id = "lokalchat-open"'));
await cp(join(root, 'LICENSE'), join(packageRoot, 'LICENSE'));
let files = 0;
async function count(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Template cannot contain symbolic links'); if (entry.isDirectory()) await count(join(directory, entry.name)); else files++; } }
await count(template);
console.log(`Prepared bundled template (${files} files). Review npm pack --dry-run before publishing.`);
