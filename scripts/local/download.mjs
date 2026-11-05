import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { CLI_VERSION } from './config.mjs';

// Official v3.0.0 checksums, pinned with this installer rather than fetched as mutable metadata.
const checksums = {
  linux_x64: 'eeb61edcd59a4735fcb5e58596574f25d03d420efca779f43ddb307e1cc5c754',
  linux_arm64: '243474fb5b491a0df04682fc1941cc5519559a1178ae01c225c633eda2e8acb8',
  darwin_x64: 'd14cdb8536eb37b0f3b6d8c70fa5497b941f71005f0b2ac152b6e6c62864529c',
  darwin_arm64: '3b0bfc4602cd7d55ffc78a6b72443d3b8e5fdd856b777e75977978dceb3e44cc',
  win32_x64: '3c21a2770882c7ea029715c7125f6c18c98806ae4dc7e5ad5b6e5904a5a56007',
  win32_arm64: '63b8ad08455395d46f583da555ccafb9db135d52380670ac11816b62d114aafa',
};

export function cliArtifact(platform = process.platform, arch = process.arch) {
  const sha256 = checksums[`${platform}_${arch}`];
  if (!sha256) throw new Error('Automatic local setup supports Linux, macOS and Windows on x64/arm64. Use the manual setup guide on this platform.');
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform];
  const filename = `supabase_${CLI_VERSION}_${os}_${arch === 'x64' ? 'amd64' : arch}.tar.gz`;
  return { filename, sha256, binary: platform === 'win32' ? 'supabase.exe' : 'supabase' };
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Release archives contain one binary. Reject paths, links and additional entries.
// Extract with Node so bootstrap does not depend on a platform-specific shell.
export async function extractBinary(archive, destination, binary) {
  let header = Buffer.alloc(0), remaining, padding = 0;
  const extract = new Transform({
    transform(chunk, encoding, done) {
      try {
        if (remaining === undefined) {
          const needed = 512 - header.length;
          header = Buffer.concat([header, chunk.subarray(0, needed)]);
          chunk = chunk.subarray(needed);
          if (header.length < 512) return done();
          const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '');
          const checksum = parseInt(text(148, 156).trim(), 8);
          const actual = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
          if (text(0, 100) !== binary || text(345, 500) || ![0, 48].includes(header[156]) || checksum !== actual) throw new Error('Unsafe CLI release archive.');
          const size = text(124, 136).trim();
          if (!/^[0-7]+$/.test(size)) throw new Error('Invalid CLI binary size.');
          remaining = parseInt(size, 8);
          if (remaining < 1 || remaining > 300_000_000) throw new Error('Unexpected CLI binary size.');
          padding = (512 - remaining % 512) % 512;
        }
        const count = Math.min(remaining, chunk.length);
        if (count) this.push(chunk.subarray(0, count));
        remaining -= count;
        chunk = chunk.subarray(count);
        const skip = Math.min(padding, remaining === 0 ? chunk.length : 0);
        padding -= skip;
        chunk = chunk.subarray(skip);
        if (chunk.some(byte => byte !== 0)) throw new Error('Unexpected entries in CLI release archive.');
        done();
      } catch (error) { done(error); }
    },
    flush(done) { done(remaining === 0 && padding === 0 ? undefined : new Error('Incomplete CLI release archive.')); },
  });
  await pipeline(createReadStream(archive), createGunzip(), extract, createWriteStream(destination, { flags: 'wx', mode: 0o700 }));
}

export async function ensureCli(directory, { signal, fetchUrl = fetch, platform = process.platform, arch = process.arch } = {}) {
  const artifact = cliArtifact(platform, arch);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, artifact.binary);
  const receipt = join(directory, 'verified.json');
  for (const path of [binary, receipt]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('CLI cache must not contain links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    await lstat(binary);
    const saved = JSON.parse(await readFile(receipt, 'utf8'));
    if (saved.archive !== artifact.sha256 || saved.binary !== await hashFile(binary)) throw new Error('CLI cache verification failed. Remove only the cli cache folder, then retry.');
    return binary;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = await mkdtemp(join(directory, 'download-'));
  try {
    const archive = join(temp, artifact.filename);
    const response = await fetchUrl(`https://github.com/supabase/cli/releases/download/v${CLI_VERSION}/${artifact.filename}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(900_000)]) : AbortSignal.timeout(900_000),
    });
    if (!response.ok || !response.body) throw new Error(`Could not download Supabase CLI (HTTP ${response.status}). Check your connection and retry the setup command.`);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > 150_000_000 ? new Error('CLI download is unexpectedly large.') : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
    if (await hashFile(archive) !== artifact.sha256) throw new Error('Supabase CLI checksum mismatch. Nothing was executed.');
    const extracted = join(temp, artifact.binary);
    await extractBinary(archive, extracted, artifact.binary);
    await chmod(extracted, 0o700);
    const binaryHash = await hashFile(extracted);
    await rename(extracted, binary);
    await writeFile(receipt, JSON.stringify({ archive: artifact.sha256, binary: binaryHash }), { mode: 0o600 });
    return binary;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
