'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseGithubUrl } = require('../src/lib/github');
const { detectRunStrategy, applyPatches } = require('../src/lib/e2b');
const { encrypt, decrypt } = require('../src/lib/crypto-helpers');

const TEST_KEY = Buffer.alloc(32, 0x42); // deterministic 32-byte key for tests

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
