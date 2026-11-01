import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
// Keep server secrets out of source and load the operator's private env file.
const envFile = process.env.LOKALCHAT_ENV_FILE || '.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);
else if (process.env.LOKALCHAT_ENV_FILE) throw new Error('Configured LokalChat env file does not exist');
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3000', '--strictPort', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Could not start LokalChat server'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
