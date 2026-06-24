'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseGithubUrl } = require('../src/lib/github');
const { detectRunStrategy, applyPatches } = require('../src/lib/e2b');
const { encrypt, decrypt } = require('../src/lib/crypto-helpers');

const TEST_KEY = Buffer.alloc(32, 0x42); // deterministic 32-byte key for tests

const DB_MODULE = path.resolve(__dirname, '../src/lib/db.js');

// Run src/lib/db.js in a fresh process with a controlled environment. db.js reads
// ENCRYPTION_KEY/DB_PATH at require time and may call process.exit(1), so it has to
// be exercised out-of-process to be testable.
function runDb(script, envOverrides) {
  const env = { ...process.env, ...envOverrides };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
  }
  return spawnSync(process.execPath, ['-e', script], {
    env,
    encoding: 'utf8',
  });
}

// ── parseGithubUrl ────────────────────────────────────────────────────────────

test('parseGithubUrl: plain repo URL', () => {
  const r = parseGithubUrl('https://github.com/alice/my-project');
  assert.deepEqual(r, { owner: 'alice', repo: 'my-project', branch: null });
});

test('parseGithubUrl: .git suffix is stripped', () => {
  const r = parseGithubUrl('https://github.com/alice/my-project.git');
  assert.deepEqual(r, { owner: 'alice', repo: 'my-project', branch: null });
});

test('parseGithubUrl: branch in URL', () => {
  const r = parseGithubUrl('https://github.com/alice/my-project/tree/feature-x');
  assert.deepEqual(r, { owner: 'alice', repo: 'my-project', branch: 'feature-x' });
});

test('parseGithubUrl: returns null for non-GitHub URL', () => {
  assert.equal(parseGithubUrl('https://gitlab.com/alice/repo'), null);
});

test('parseGithubUrl: returns null for garbage input', () => {
  assert.equal(parseGithubUrl('not a url'), null);
});

// ── detectRunStrategy ─────────────────────────────────────────────────────────

test('detectRunStrategy: Python with requirements.txt', () => {
  const files = [{ path: 'requirements.txt' }, { path: 'main.py' }];
  const s = detectRunStrategy(files);
  assert.match(s.install, /pip install/);
  assert.match(s.test, /pytest/);
});

test('detectRunStrategy: Python without requirements.txt', () => {
  const files = [{ path: 'main.py' }, { path: 'helper.py' }];
  const s = detectRunStrategy(files);
  assert.equal(s.install, null);
  assert.match(s.test, /pytest/);
});

test('detectRunStrategy: Node.js project', () => {
  const files = [{ path: 'package.json' }, { path: 'index.js' }];
  const s = detectRunStrategy(files);
  assert.match(s.install, /npm install/);
  assert.equal(s.test, 'npm test 2>&1');
});

test('detectRunStrategy: Maven project', () => {
  const files = [{ path: 'pom.xml' }, { path: 'src/Main.java' }];
  const s = detectRunStrategy(files);
  assert.equal(s.install, null);
  assert.match(s.test, /mvn test/);
});

test('detectRunStrategy: unknown project returns shell fallback', () => {
  const files = [{ path: 'README.md' }];
  const s = detectRunStrategy(files);
  assert.equal(s.install, null);
  assert.match(s.test, /Could not detect/);
});

// ── applyPatches ──────────────────────────────────────────────────────────────

test('applyPatches: applies a simple replacement', () => {
  const files = [{ path: 'main.py', content: 'x = 1\ny = 2\n' }];
  const patches = [{ path: 'main.py', search: 'x = 1', replace: 'x = 42' }];
  const result = applyPatches(files, patches);
  assert.equal(result[0].content, 'x = 42\ny = 2\n');
});

test('applyPatches: skips patch when search string not found', () => {
  const files = [{ path: 'main.py', content: 'x = 1\n' }];
  const patches = [{ path: 'main.py', search: 'z = 99', replace: 'z = 0' }];
  const result = applyPatches(files, patches);
  assert.equal(result[0].content, 'x = 1\n');
});

test('applyPatches: skips patch for unknown file path', () => {
  const files = [{ path: 'main.py', content: 'x = 1\n' }];
  const patches = [{ path: 'other.py', search: 'x = 1', replace: 'x = 2' }];
  const result = applyPatches(files, patches);
  assert.equal(result[0].content, 'x = 1\n');
});

// ── detectRunStrategy: precedence regression ──────────────────────────────────

test('detectRunStrategy: Python test command does not chain main.py with &&', () => {
  // The old bug: `|| echo "..." && python main.py` always ran main.py because
  // || and && have equal precedence (left-associative), so echo always succeeded,
  // making python main.py run even when tests passed.
  const files = [{ path: 'requirements.txt' }, { path: 'main.py' }];
  const s = detectRunStrategy(files);
  assert.doesNotMatch(s.test, /echo.*&&.*python main\.py/);
});

test('detectRunStrategy: Python test command uses exit-code guard for main.py fallback', () => {
  const files = [{ path: 'main.py' }];
  const s = detectRunStrategy(files);
  // Fixed form checks $? or _rc to only run main.py when pytest finds no tests (exit 5).
  assert.match(s.test, /_rc/);
});

// ── encrypt / decrypt ─────────────────────────────────────────────────────────

test('encrypt/decrypt: round-trip preserves plaintext', () => {
  const { encrypted, iv, authTag } = encrypt(TEST_KEY, 'hello world');
  assert.equal(decrypt(TEST_KEY, encrypted, iv, authTag), 'hello world');
});

test('encrypt/decrypt: round-trip preserves unicode and long strings', () => {
  const long = '日本語テスト '.repeat(200);
  const { encrypted, iv, authTag } = encrypt(TEST_KEY, long);
  assert.equal(decrypt(TEST_KEY, encrypted, iv, authTag), long);
});

test('encrypt/decrypt: each call produces a unique ciphertext (random IV)', () => {
  const a = encrypt(TEST_KEY, 'same plaintext');
  const b = encrypt(TEST_KEY, 'same plaintext');
  assert.notEqual(a.encrypted, b.encrypted);
  assert.notEqual(a.iv, b.iv);
});

test('decrypt: tampered auth tag throws (integrity check)', () => {
  const { encrypted, iv, authTag } = encrypt(TEST_KEY, 'sensitive data');
  const tampered = authTag.slice(0, -2) + (authTag.slice(-2) === 'ff' ? '00' : 'ff');
  assert.throws(() => decrypt(TEST_KEY, encrypted, iv, tampered));
});

test('decrypt: tampered ciphertext throws (integrity check)', () => {
  const { encrypted, iv, authTag } = encrypt(TEST_KEY, 'sensitive data');
  const tampered = (parseInt(encrypted[0], 16) ^ 1).toString(16) + encrypted.slice(1);
  assert.throws(() => decrypt(TEST_KEY, tampered, iv, authTag));
});

test('decrypt: a different key cannot read old ciphertext (key rotation)', () => {
  // This is the failure mode getHistory now guards against: rotate ENCRYPTION_KEY
  // and every previously-stored row becomes undecryptable.
  const otherKey = Buffer.alloc(32, 0x37);
  const { encrypted, iv, authTag } = encrypt(TEST_KEY, 'previously stored message');
  assert.throws(() => decrypt(otherKey, encrypted, iv, authTag));
});

// ── db.js: fail-closed ENCRYPTION_KEY validation ──────────────────────────────

const KEY_A = Buffer.alloc(32, 0x42).toString('hex'); // 64 hex chars
const KEY_B = Buffer.alloc(32, 0x37).toString('hex'); // different valid key

test('db: refuses to start when ENCRYPTION_KEY is missing', () => {
  const r = runDb(`require(${JSON.stringify(DB_MODULE)})`, {
    ENCRYPTION_KEY: undefined,
    DB_PATH: ':memory:',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENCRYPTION_KEY is not set/);
});

test('db: refuses to start when ENCRYPTION_KEY is the wrong length', () => {
  const r = runDb(`require(${JSON.stringify(DB_MODULE)})`, {
    ENCRYPTION_KEY: 'abcd', // valid hex but only 2 bytes, not 32
    DB_PATH: ':memory:',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENCRYPTION_KEY must be 64 hex characters/);
});

test('db: starts with a correct 64-hex-char ENCRYPTION_KEY', () => {
  const r = runDb(`require(${JSON.stringify(DB_MODULE)})`, {
    ENCRYPTION_KEY: KEY_A,
    DB_PATH: ':memory:',
  });
  assert.equal(r.status, 0, r.stderr);
});

// ── db.js: getHistory is fail-soft across a key rotation ──────────────────────

test('getHistory: skips undecryptable rows after a key rotation instead of crashing', () => {
  const dbFile = path.join(os.tmpdir(), `dcbot-test-${process.pid}-${Date.now()}.db`);
  const cleanup = () => {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(dbFile + suffix); } catch { /* may not exist */ }
    }
  };

  try {
    // Write a message under KEY_A and confirm it reads back decrypted.
    const write = runDb(
      `const db=require(${JSON.stringify(DB_MODULE)});` +
      `db.appendMessage('u1','user','secret hello');` +
      `process.stdout.write(JSON.stringify(db.getHistory('u1')));`,
      { ENCRYPTION_KEY: KEY_A, DB_PATH: dbFile }
    );
    assert.equal(write.status, 0, write.stderr);
    assert.deepEqual(JSON.parse(write.stdout), [{ role: 'user', content: 'secret hello' }]);

    // Re-open the same database with a rotated key. The stored row can no longer be
    // decrypted; getHistory must return [] without throwing (the old bug crashed /ask).
    const read = runDb(
      `const db=require(${JSON.stringify(DB_MODULE)});` +
      `process.stdout.write(JSON.stringify(db.getHistory('u1')));`,
      { ENCRYPTION_KEY: KEY_B, DB_PATH: dbFile }
    );
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), []);
  } finally {
    cleanup();
  }
});
