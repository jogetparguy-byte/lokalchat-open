import { DatabaseSync } from "node:sqlite";
import { chmodSync, lstatSync, mkdirSync, openSync, closeSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { parseOnboarding } from "./onboarding";

const SESSION_SECONDS = 60 * 60 * 24 * 7;
type AccountRow = { id: string; email: string; salt: string; password: string; metadata: string; profile: string; created_at: string };
type SessionRow = { account_id: string; expires: number };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function database() {
  const path = resolve(process.env["LOKALCHAT_ACCOUNT_DB"] || ".lokalchat/accounts.sqlite");
  for (let part = path; ; part = dirname(part)) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Error("Unsafe account storage path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (part === dirname(part)) break;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { closeSync(openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, metadata TEXT NOT NULL, profile TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
  return db;
}

async function passwordHash(password: string, salt: string) {
  return new Promise<Buffer>((done, reject) => derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : done(key)));
}

function publicUser(row: AccountRow): User {
  return { id: row.id, email: row.email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "lokalchat" }, user_metadata: JSON.parse(row.metadata), created_at: row.created_at };
}

function throttle(email: string) {
  const db = database();
  try {
    const now = Date.now();
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM attempts WHERE until < ?").run(now);
    for (const [key, limit] of [["all", 100], [hash(email), 10]] as const) {
      const row = db.prepare("SELECT count FROM attempts WHERE key = ?").get(key) as { count: number } | undefined;
      if ((row?.count || 0) >= limit) throw new Error("Terlalu banyak cubaan. Cuba lagi dalam 15 minit.");
      db.prepare("INSERT INTO attempts VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1").run(key, now + 15 * 60 * 1000);
    }
    db.exec("COMMIT");
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}

export async function authenticateAccount(input: { email: string; password: string; businessName?: string; onboarding?: unknown }, signup: boolean, oldToken?: string) {
  const email = input.email?.trim().toLowerCase();
  const password = input.password;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Masukkan alamat emel yang sah.");
  if (typeof password !== "string" || password.length < 8 || password.length > 256) throw new Error("Kata laluan mesti 8 hingga 256 aksara.");
  throttle(email);
  const db = database();
  try {
    let row = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email) as AccountRow | undefined;
    // Derive even for unknown accounts to avoid a fast account-existence probe.
    const salt = signup || !row ? randomBytes(32).toString("hex") : row.salt;
    const derived = await passwordHash(password, salt);
    if (signup) {
      if (row) throw new Error("Pendaftaran tidak berjaya. Cuba log masuk atau gunakan emel lain.");
      const name = (input.businessName || "Kedai Saya").trim().slice(0, 160) || "Kedai Saya";
      row = { id: randomUUID(), email, salt, password: derived.toString("hex"), metadata: JSON.stringify({ business_name: name, ...parseOnboarding(input.onboarding) }), profile: JSON.stringify({ business_name: name, inventory_api_url: null, owner_whatsapp: null }), created_at: new Date().toISOString() };
      try { db.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.id, row.email, row.salt, row.password, row.metadata, row.profile, row.created_at); }
      catch { throw new Error("Pendaftaran tidak berjaya. Cuba log masuk atau gunakan emel lain."); }
    } else if (!row || !timingSafeEqual(derived, Buffer.from(row.password, "hex")) || (db.prepare("SELECT password FROM accounts WHERE id = ?").get(row.id) as { password: string } | undefined)?.password !== row.password) {
      throw new Error("Emel atau kata laluan tidak tepat.");
    }
    const token = randomBytes(32).toString("base64url");
    db.exec("BEGIN IMMEDIATE");
    if (oldToken) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(oldToken));
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hash(token), row.id, Date.now() + SESSION_SECONDS * 1000);
    db.exec("COMMIT");
    return { user: publicUser(row), token, maxAge: SESSION_SECONDS };
  } finally { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); }
}

export function readAccount(token?: string): User | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = database();
  try {
    const row = db.prepare("SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND expires > ?").get(hash(token), Date.now()) as AccountRow | undefined;
    return row ? publicUser(row) : null;
  } finally { db.close(); }
}

export function revokeAccountSessions(token: string, scope: "local" | "global" | "others") {
  const db = database();
  try {
    const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires > ?").get(hash(token), Date.now()) as SessionRow | undefined;
    if (!session) return;
    if (scope === "local") db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
    else if (scope === "global") db.prepare("DELETE FROM sessions WHERE account_id = ?").run(session.account_id);
    else db.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash != ?").run(session.account_id, hash(token));
  } finally { db.close(); }
}

export async function updateAccount(token: string, input: { data?: Record<string, unknown>; password?: string; current_password?: string }) {
  const user = readAccount(token);
  if (!user) throw new Error("Sila log masuk semula.");
  if (input.data && (typeof input.data !== "object" || Array.isArray(input.data) || JSON.stringify(input.data).length > 8000)) throw new Error("Maklumat akaun tidak sah.");
  const allowed = ["full_name", "business_name", "lokalchat_reply_language", "lokalchat_weekly_report"];
  const metadata = { ...user.user_metadata };
  for (const key of allowed) if (Object.hasOwn(input.data || {}, key)) {
    const value = input.data![key];
    if (key === "lokalchat_weekly_report" ? typeof value !== "boolean" : typeof value !== "string" || value.length > 160) throw new Error("Maklumat akaun tidak sah.");
    metadata[key] = value;
  }
  const db = database();
  try {
    if (input.password !== undefined) {
      throttle(user.email!);
      if (typeof input.password !== "string" || input.password.length < 8 || input.password.length > 256 || typeof input.current_password !== "string" || input.current_password.length > 256) throw new Error("Masukkan kata laluan semasa dan kata laluan baharu (8 hingga 256 aksara).");
      const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(user.id) as AccountRow;
      const current = await passwordHash(input.current_password, row.salt);
      if (!timingSafeEqual(current, Buffer.from(row.password, "hex"))) throw new Error("Kata laluan semasa tidak tepat.");
      const salt = randomBytes(32).toString("hex");
      const next = await passwordHash(input.password, salt);
      db.prepare("UPDATE accounts SET salt = ?, password = ? WHERE id = ?").run(salt, next.toString("hex"), user.id);
      db.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash != ?").run(user.id, hash(token));
    }
    db.prepare("UPDATE accounts SET metadata = ? WHERE id = ?").run(JSON.stringify(metadata), user.id);
    return { ...user, user_metadata: metadata };
  } finally { db.close(); }
}

export function accountProfile(userId: string, patch?: Record<string, unknown>) {
  const db = database();
  try {
    const row = db.prepare("SELECT profile FROM accounts WHERE id = ?").get(userId) as { profile: string } | undefined;
    if (!row) throw new Error("Sila log masuk semula.");
    const profile = { id: userId, ...JSON.parse(row.profile) } as { id: string; business_name: string; inventory_api_url: string | null; owner_whatsapp: string | null };
    if (patch) { Object.assign(profile, patch); db.prepare("UPDATE accounts SET profile = ? WHERE id = ?").run(JSON.stringify(profile), userId); }
    return profile;
  } finally { db.close(); }
}
