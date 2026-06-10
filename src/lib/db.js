const Database = require('better-sqlite3');
const path = require('path');
const { encrypt: _encrypt, decrypt: _decrypt } = require('./crypto-helpers');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../bot.db');

if (!process.env.ENCRYPTION_KEY) {
  console.error('[db] ENCRYPTION_KEY is not set. Cannot start safely — user API keys would be encrypted with a known fallback key.');
  process.exit(1);
}

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

// Partially apply the server key so the rest of the file uses a stable 2-arg interface.
const encrypt = (plaintext) => _encrypt(ENCRYPTION_KEY, plaintext);
const decrypt = (enc, iv, tag) => _decrypt(ENCRYPTION_KEY, enc, iv, tag);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
    content    TEXT    NOT NULL,
    iv         TEXT,
    auth_tag   TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);

  CREATE TABLE IF NOT EXISTS user_keys (
    user_id       TEXT PRIMARY KEY,
    encrypted_key TEXT NOT NULL,
    iv            TEXT NOT NULL,
    auth_tag      TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS e2b_keys (
    user_id       TEXT PRIMARY KEY,
    encrypted_key TEXT NOT NULL,
    iv            TEXT NOT NULL,
    auth_tag      TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: add iv/auth_tag to messages for at-rest encryption if upgrading from
// an older schema that didn't have those columns.
try {
  db.exec('ALTER TABLE messages ADD COLUMN iv TEXT');
  db.exec('ALTER TABLE messages ADD COLUMN auth_tag TEXT');
} catch {
  // columns already exist — no-op
}

// ── Generic encrypted key helpers ────────────────────────────────────────────

function setKey(table, userId, apiKey) {
  const { encrypted, iv, authTag } = encrypt(apiKey);
  db.prepare(`
    INSERT INTO ${table} (user_id, encrypted_key, iv, auth_tag)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_key = excluded.encrypted_key,
      iv            = excluded.iv,
      auth_tag      = excluded.auth_tag,
      created_at    = CURRENT_TIMESTAMP
  `).run(userId, encrypted, iv, authTag);
}

function getKey(table, userId) {
  const row = db
    .prepare(`SELECT encrypted_key, iv, auth_tag FROM ${table} WHERE user_id = ?`)
    .get(userId);
  if (!row) return null;
  try { return decrypt(row.encrypted_key, row.iv, row.auth_tag); }
  catch { return null; }
}

function clearKey(table, userId) {
  db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
}

function hasKey(table, userId) {
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ?`).get(userId);
}

// ── Conversation history ─────────────────────────────────────────────────────

function getHistory(userId, limit = 40) {
  return db
    .prepare(`SELECT role, content, iv, auth_tag FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit)
    .reverse()
    .map((row) => ({
      role: row.role,
      // iv is null for messages written before encryption was added — return as-is.
      content: row.iv ? decrypt(row.content, row.iv, row.auth_tag) : row.content,
    }));
}

function appendMessage(userId, role, content) {
  const { encrypted, iv, authTag } = encrypt(content);
  db.prepare(`INSERT INTO messages (user_id, role, content, iv, auth_tag) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, role, encrypted, iv, authTag);
}

function clearHistory(userId) {
  db.prepare(`DELETE FROM messages WHERE user_id = ?`).run(userId);
  return db.prepare(`SELECT changes() as n`).get().n;
}

function countMessages(userId) {
  return db.prepare(`SELECT COUNT(*) as n FROM messages WHERE user_id = ?`).get(userId).n;
}

// ── Anthropic API keys ───────────────────────────────────────────────────────

const setUserKey    = (userId, key) => setKey('user_keys', userId, key);
const getUserKey    = (userId)      => getKey('user_keys', userId);
const clearUserKey  = (userId)      => clearKey('user_keys', userId);
const hasUserKey    = (userId)      => hasKey('user_keys', userId);

// ── E2B API keys ─────────────────────────────────────────────────────────────

const setUserE2BKey   = (userId, key) => setKey('e2b_keys', userId, key);
const getUserE2BKey   = (userId)      => getKey('e2b_keys', userId);
const clearUserE2BKey = (userId)      => clearKey('e2b_keys', userId);
const hasUserE2BKey   = (userId)      => hasKey('e2b_keys', userId);

module.exports = {
  getHistory, appendMessage, clearHistory, countMessages,
  setUserKey, getUserKey, clearUserKey, hasUserKey,
  setUserE2BKey, getUserE2BKey, clearUserE2BKey, hasUserE2BKey,
};
