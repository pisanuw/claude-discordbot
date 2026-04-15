const { Sandbox } = require('e2b');

const SANDBOX_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per session
const CMD_TIMEOUT_MS     = 60 * 1000;     // 60 seconds per command
const WORK_DIR           = '/home/user/repo';

/**
 * Detect the appropriate install + test command from repo files.
 * Returns { install: string|null, test: string }
 */
function detectRunStrategy(files) {
  const paths = files.map((f) => f.path);
  const has = (name) => paths.some((p) => p === name || p.endsWith('/' + name));

  // Python
  if (has('requirements.txt') && paths.some((p) => p.endsWith('.py'))) {
    return {
      install: 'pip install -r requirements.txt -q',
      test: 'python -m pytest --tb=short -v 2>&1 || python -m pytest --tb=short 2>&1 || echo "No pytest tests found — running main.py" && python main.py 2>&1',
    };
  }
  if (paths.some((p) => p.endsWith('.py'))) {
    return {
      install: null,
      test: 'python -m pytest --tb=short -v 2>&1 || python main.py 2>&1',
    };
  }

  // Node.js
  if (has('package.json')) {
    return {
      install: 'npm install --silent 2>&1',
      test: 'npm test 2>&1',
    };
  }

  // Java Maven
  if (has('pom.xml')) {
    return {
      install: null,
      test: 'mvn test -q 2>&1',
    };
  }

  // Makefile
  if (has('Makefile') || has('makefile')) {
    return {
      install: null,
      test: 'make test 2>&1 || make 2>&1',
    };
  }

  // Shell script fallback
  return {
    install: null,
    test: 'echo "Could not detect test runner. Try /run with a focus hint describing your language and test command."',
  };
}

/**
 * Create a sandbox, write all repo files into it, and run the test suite.
 *
 * @param {string}   e2bApiKey  - E2B API key
 * @param {Array}    files      - [{ path, content }] from fetchRepo()
 * @param {string}   [runCmd]   - Override the auto-detected test command
 * @returns {{ stdout, stderr, exitCode, strategy }}
 */
async function runInSandbox(e2bApiKey, files, runCmd) {
  const sandbox = await Sandbox.create({
    apiKey: e2bApiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  try {
    // Write all files
    for (const file of files) {
      const fullPath = `${WORK_DIR}/${file.path}`;
      await sandbox.files.write(fullPath, file.content);
    }

    const strategy = detectRunStrategy(files);

    // Install dependencies if needed
    if (strategy.install) {
      await sandbox.commands.run(strategy.install, {
        cwd: WORK_DIR,
        timeoutMs: CMD_TIMEOUT_MS,
      });
    }

    // Run tests (or custom command)
    const cmd = runCmd || strategy.test;
    const result = await sandbox.commands.run(cmd, {
      cwd: WORK_DIR,
      timeoutMs: CMD_TIMEOUT_MS,
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode ?? 0,
      strategy,
    };
  } finally {
    await sandbox.kill().catch(() => {});
  }
}

/**
 * Apply an array of patches to in-memory file contents.
 * patches: [{ path, search, replace }]
 * Returns a new files array with modifications applied.
 */
function applyPatches(files, patches) {
  const fileMap = Object.fromEntries(files.map((f) => [f.path, f.content]));

  for (const patch of patches) {
    if (!fileMap[patch.path]) continue;
    if (!fileMap[patch.path].includes(patch.search)) {
      console.warn(`[e2b] Patch search string not found in ${patch.path} — skipping`);
      continue;
    }
    fileMap[patch.path] = fileMap[patch.path].replace(patch.search, patch.replace);
  }

  return files.map((f) => ({ path: f.path, content: fileMap[f.path] }));
}

module.exports = { runInSandbox, applyPatches, detectRunStrategy };
