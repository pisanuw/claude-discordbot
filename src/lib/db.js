const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../bot.db');

const ENCRYPTION_KEY = Buffer.from(
  process.env.ENCRYPTION_KEY || '0'.repeat(64),
  'hex'
);

if (!process.env.ENCRYPTION_KEY) {
  console.warn('[db] WARNING: ENCRYPTION_KEY not set. User API keys will not be stored securely.');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
    content    TEXT    NOT NULL,
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

// ── Encryption helpers ───────────────────────────────────────────────────────

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(encryptedHex, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
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
    .prepare(
      `SELECT role, content FROM messages
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit)
    .reverse();
}

function appendMessage(userId, role, content) {
  db.prepare(`INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)`).run(userId, role, content);
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
