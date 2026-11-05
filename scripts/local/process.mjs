import { spawn } from 'node:child_process';

// Keep credentials from CLI output in a private log, never the terminal.
export function createRunner({ cwd, env, log, signal, spawnChild = spawn }) {
  return async (command, args, { capture = false, visible = false, timeout = 900_000, cleanup = false, cwd: commandCwd = cwd, env: commandEnv = env } = {}) => {
    if (!cleanup) signal?.throwIfAborted();
    const child = spawnChild(command, args, { cwd: commandCwd, env: commandEnv, shell: false, stdio: visible ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let killTimer, timedOut = false, capturedBytes = 0;
    const chunks = [];
    const terminate = () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 10_000);
    };
    const abort = () => terminate();
    if (!cleanup) signal?.addEventListener('abort', abort, { once: true });
    if (!visible) {
      child.stdout.on('data', chunk => {
        log.write(chunk);
        if (capture && (capturedBytes += chunk.length) <= 2_000_000) chunks.push(chunk);
      });
      child.stderr.on('data', chunk => log.write(chunk));
    }
    const timer = timeout ? setTimeout(() => { timedOut = true; terminate(); }, timeout) : undefined;
    try {
      const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
      if (!cleanup) signal?.throwIfAborted();
      if (timedOut) throw new Error('This step exceeded its time limit. Check the private log before trying again.');
      if (code !== 0 || capturedBytes > 2_000_000) throw new Error('A setup command failed. Check the private log; no automatic retry was made.');
      return Buffer.concat(chunks).toString();
    } finally {
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
