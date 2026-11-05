import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";

export function envPath(userId: string) {
  // Only the server operator selects the file. Never accept a path from a request.
  // userId must come from verified Auth context (or a persisted chat owner).
  if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Identiti pengguna tidak sah");
  }
  // The same UUID in two Auth projects must not resolve to the same credentials.
  const issuer = (process.env["SUPABASE_URL"] || "unconfigured").replace(/\/+$/, "");
  const project = createHash("sha256").update(issuer).digest("hex");
  return resolve(process.env["LOKALCHAT_USER_ENV_DIR"] || ".lokalchat/users", project, userId.toLowerCase(), ".env");
}

async function assertRegularPath(path: string) {
  for (let part = path; ; part = dirname(part)) {
    try {
      const stat = await lstat(part);
      if (stat.isSymbolicLink() || (part === path && !stat.isFile())) throw new Error("Unsafe env path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (part === dirname(part)) break;
  }
}

export async function readSettingsFile(path: string) {
  await assertRegularPath(path);
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** Replace complete assignments, including duplicates and quoted multiline values. */
function updateAssignments(content: string, updates: Record<string, string>) {
  const chunks = content.match(/[^\n]*\n|[^\n]+$/g) || [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    let chunk = chunks[index]!;
    const match = chunk.match(/^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([^\r\n]*)/);
    if (match) {
      const value = match[2]!;
      const quote = value[0];
      if (quote === '"' || quote === "'" || quote === "`") {
        let rest = value.slice(1);
        while (!rest.includes(quote)) {
          if (++index >= chunks.length) throw new Error("Unclosed env value");
          rest += chunks[index]!;
          chunk += chunks[index]!;
        }
      }
      const name = match[1]!;
      if (Object.hasOwn(updates, name)) {
        if (!seen.has(name)) output.push(`${name}='${updates[name]}'\n`);
        seen.add(name);
        continue;
      }
    }
    output.push(chunk);
  }
  let next = output.join("");
  if (next && !next.endsWith("\n")) next += "\n";
  for (const name of Object.keys(updates)) if (!seen.has(name)) next += `${name}='${updates[name]}'\n`;
  // Catch parser differences before replacing any operator configuration.
  const parsed = parseEnv(next);
  for (const name of Object.keys(updates)) if (parsed[name] !== updates[name]) throw new Error("Invalid env serialization");
  return next;
}

/** Serialize all Settings writers through one lock, preserving unrelated env values. */
export async function updateEnvSettings(userId: string, updates: (saved: Record<string, string | undefined>) => Record<string, string>) {
  const path = envPath(userId);
  const lockPath = `${path}.settings.lock`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  let locked = false;
  try {
    await assertRegularPath(path);
    // Create private directories without following pre-existing symlinks.
    const root = dirname(dirname(path));
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await assertRegularPath(path);
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    locked = true;
    await lock.close();
    const original = await readSettingsFile(path);
    const next = updateAssignments(original, updates(parseEnv(original)));
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(next, "utf8"); await file.sync(); }
    finally { await file.close(); }
    await assertRegularPath(path);
    await rename(temporary, path);
    return parseEnv(next);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    if (locked) await rm(lockPath, { force: true }).catch(() => {});
  }
}
