// Free user accounts: sign up / sign in / sign out, and a per-account watchlist.
//
// Storage: Node's built-in SQLite (no extra dependency), file at
// $ACCOUNTS_DB or .cache/accounts.sqlite (git-ignored). Keep this file on
// persistent storage (it is on the Oracle VM) and back it up.
//
// Security:
// - Passwords: scrypt (N=16384, r=8, p=1, 64-byte key) with a random 16-byte
//   salt per user; compared in constant time. Plain passwords are never stored
//   or logged.
// - Sessions: random 32-byte tokens; only their SHA-256 hash is stored. Sent as
//   an HttpOnly, SameSite=Lax cookie (Secure over HTTPS). 30-day expiry.
// - Login/sign-up attempts are rate limited per IP and per email.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_TTL_MS = 30 * 86_400_000;
export const WATCHLIST_MAX = 50;
/** Per-account saved settings (e.g. the Super Charts market list). */
export const PREF_KEYS = ["market-list", "super-charts"];
export const PREF_MAX_BYTES = 16_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const COIN = /^[A-Z0-9]{1,30}$/;

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) throw new AccountError(400, "Enter a valid email address.");
  return email;
}
export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8) throw new AccountError(400, "Password must be at least 8 characters.");
  if (value.length > 128) throw new AccountError(400, "Password must be at most 128 characters.");
  return value;
}
export function normalizeCoin(value) {
  const coin = typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!COIN.test(coin)) throw new AccountError(400, "Invalid coin.");
  return coin;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
// Hash of nothing, so unknown emails cost the same scrypt work as real ones.
const DUMMY_HASH = ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
  Buffer.alloc(16).toString("base64"), Buffer.alloc(SCRYPT.keylen).toString("base64")].join("$");
const tokenHash = token => createHash("sha256").update(token).digest("hex");

/** Fixed-window attempt limiter (in memory, per process). */
export function createAttemptLimiter({ limit = 10, windowMs = 15 * 60_000, now = Date.now } = {}) {
  const buckets = new Map();
  return {
    hit(key) {
      const time = now();
      const bucket = buckets.get(key);
      if (!bucket || time >= bucket.resetAt) { buckets.set(key, { count: 1, resetAt: time + windowMs }); return true; }
      bucket.count += 1;
      if (buckets.size > 10_000) for (const [k, b] of buckets) if (time >= b.resetAt) buckets.delete(k);
      return bucket.count <= limit;
    },
  };
}

export function createAccountService({
  file = process.env.ACCOUNTS_DB || fileURLToPath(new URL("../.cache/accounts.sqlite", import.meta.url)),
  now = Date.now,
} = {}) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coin TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, coin)
    );
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
  const q = {
    userByEmail: db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?"),
    insertUser: db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: db.prepare(`SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    listWatch: db.prepare("SELECT coin FROM watchlist WHERE user_id = ? ORDER BY added_at, coin"),
    countWatch: db.prepare("SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?"),
    addWatch: db.prepare("INSERT OR IGNORE INTO watchlist (user_id, coin, added_at) VALUES (?, ?, ?)"),
    removeWatch: db.prepare("DELETE FROM watchlist WHERE user_id = ? AND coin = ?"),
    getPref: db.prepare("SELECT value FROM user_prefs WHERE user_id = ? AND key = ?"),
    setPref: db.prepare(`INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
  };
  q.purgeSessions.run(now());

  function startSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const created = now();
    q.insertSession.run(tokenHash(token), userId, created, created + SESSION_TTL_MS);
    return { token, expiresAt: created + SESSION_TTL_MS };
  }

  return {
    async signup(emailInput, passwordInput) {
      const email = normalizeEmail(emailInput);
      const password = validatePassword(passwordInput);
      if (q.userByEmail.get(email)) throw new AccountError(409, "An account with this email already exists. Please sign in.");
      const hash = await hashPassword(password);
      let id;
      try { id = Number(q.insertUser.run(email, hash, now()).lastInsertRowid); }
      catch { throw new AccountError(409, "An account with this email already exists. Please sign in."); }
      return { user: { id, email }, ...startSession(id) };
    },
    async login(emailInput, passwordInput) {
      let email;
      try { email = normalizeEmail(emailInput); } catch { throw new AccountError(401, "Email or password is incorrect."); }
      const row = q.userByEmail.get(email);
      // Same work whether or not the account exists (no timing hint).
      const ok = await verifyPassword(typeof passwordInput === "string" ? passwordInput.slice(0, 128) : "",
        row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw new AccountError(401, "Email or password is incorrect.");
      return { user: { id: Number(row.id), email: row.email }, ...startSession(Number(row.id)) };
    },
    userForToken(token) {
      if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
      const row = q.sessionUser.get(tokenHash(token));
      if (!row) return null;
      if (row.expires_at <= now()) { q.deleteSession.run(tokenHash(token)); return null; }
      return { id: Number(row.id), email: row.email };
    },
    logout(token) {
      if (typeof token === "string" && token) q.deleteSession.run(tokenHash(token));
    },
    watchlist(userId) {
      return q.listWatch.all(userId).map(row => row.coin);
    },
    addWatch(userId, coinInput) {
      const coin = normalizeCoin(coinInput);
      const exists = q.listWatch.all(userId).some(row => row.coin === coin);
      if (!exists && q.countWatch.get(userId).n >= WATCHLIST_MAX)
        throw new AccountError(400, `Your watchlist can hold up to ${WATCHLIST_MAX} coins.`);
      q.addWatch.run(userId, coin, now());
      return this.watchlist(userId);
    },
    removeWatch(userId, coinInput) {
      q.removeWatch.run(userId, normalizeCoin(coinInput));
      return this.watchlist(userId);
    },
    /** Saved settings object for one key, or null. */
    getPref(userId, key) {
      if (!PREF_KEYS.includes(key)) throw new AccountError(404, "Unknown setting.");
      const row = q.getPref.get(userId, key);
      if (!row) return null;
      try { return JSON.parse(row.value); } catch { return null; }
    },
    setPref(userId, key, value) {
      if (!PREF_KEYS.includes(key)) throw new AccountError(404, "Unknown setting.");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError(400, "Settings must be an object.");
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json) > PREF_MAX_BYTES) throw new AccountError(413, "Too many saved settings. Press Reset in the list and try again.");
      q.setPref.run(userId, key, json, now());
      return value;
    },
    purgeExpired() { q.purgeSessions.run(now()); },
    close() { db.close(); },
  };
}
