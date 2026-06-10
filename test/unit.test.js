'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseGithubUrl } = require('../src/lib/github');
const { detectRunStrategy, applyPatches } = require('../src/lib/e2b');

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
