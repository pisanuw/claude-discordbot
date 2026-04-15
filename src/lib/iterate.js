const Anthropic = require('@anthropic-ai/sdk');
const Diff = require('diff');
const { runInSandbox, applyPatches } = require('./e2b');

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_ITER = 3;

/**
 * Ask Claude to analyse failing test output and suggest minimal patches.
 * Returns { analysis: string, patches: [{path, search, replace}] }
 */
async function getFixFromClaude(anthropicKey, files, testOutput, iteration, focus) {
  const client = new Anthropic({ apiKey: anthropicKey });

  const fileBlock = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const prompt = `You are a coding assistant helping a student fix their code.
${focus ? `Instructor focus: ${focus}\n` : ''}
This is iteration ${iteration} of ${MAX_ITER}. The tests are currently failing.

## Current source files
${fileBlock}

## Test output
\`\`\`
${testOutput.slice(0, 3000)}
\`\`\`

Respond with ONLY a valid JSON object — no markdown, no preamble — in this exact shape:
{
  "analysis": "One paragraph explaining the root cause of the failure",
  "patches": [
    {
      "path": "relative/file/path.py",
      "search": "exact string to find (must exist verbatim in the file)",
      "replace": "replacement string"
    }
  ]
}

Rules:
- "search" must be an exact verbatim substring of the file content
- Keep patches minimal — only fix what is broken
- If the code is correct and the issue is a missing dependency or environment problem, set patches to []
- Maximum 5 patches`;

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content.find((b) => b.type === 'text')?.text || '{}';

  try {
    const clean = raw.replace(/^```json\n?|^```\n?|```$/gm, '').trim();
    return JSON.parse(clean);
  } catch {
    return { analysis: raw, patches: [] };
  }
}

/**
 * Ask Claude for a final review summary now that we have the full picture.
 */
async function getFinalReview(anthropicKey, repoId, originalFiles, finalFiles, iterations, lastOutput, passed, focus) {
  const client = new Anthropic({ apiKey: anthropicKey });

  const changedFiles = finalFiles.filter((f) => {
    const orig = originalFiles.find((o) => o.path === f.path);
    return orig && orig.content !== f.content;
  });

  const diffBlock = changedFiles.length
    ? changedFiles
        .map((f) => {
          const orig = originalFiles.find((o) => o.path === f.path);
          return Diff.createPatch(f.path, orig.content, f.content, 'original', 'suggested');
        })
        .join('\n')
    : null;

  const originalBlock = originalFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const prompt = `You are an expert code reviewer. Review the student's submission for \`${repoId}\`.
${focus ? `Instructor focus: ${focus}\n` : ''}
## Original code
${originalBlock}

## Final test output (after ${iterations} iteration${iterations === 1 ? '' : 's'})
\`\`\`
${lastOutput.slice(0, 2000)}
\`\`\`

Status: ${passed ? '✅ Tests passing' : '❌ Tests still failing after all iterations'}

Write a clear, constructive, student-friendly review covering:
- What the code does well
- Root cause of any bugs found
- Code quality, style, and best practices
- Specific actionable improvements

Be encouraging but honest. Reference specific file names and line numbers where helpful.`;

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const review = response.content.find((b) => b.type === 'text')?.text || '';
  return { review, diff: diffBlock };
}

/**
 * Main agentic loop.
 *
 * @param {string}   anthropicKey - Anthropic API key
 * @param {string}   e2bKey       - E2B API key
 * @param {object}   repoData     - Output of fetchRepo()
 * @param {string}   focus        - Optional instructor focus string
 * @param {Function} onProgress   - Called with status update strings
 *
 * @returns {{
 *   review: string,
 *   diff: string|null,
 *   passed: boolean,
 *   iterations: number,
 *   finalOutput: string,
 *   iterationLog: Array
 * }}
 */
async function runAndIterate(anthropicKey, e2bKey, repoData, focus, onProgress) {
  let files = repoData.files;
  const originalFiles = files.map((f) => ({ ...f })); // deep copy
  const iterationLog = [];
  let passed = false;
  let lastOutput = '';
  let iterations = 0;

  for (let i = 1; i <= MAX_ITER; i++) {
    iterations = i;
    if (onProgress) onProgress(`▶️ Running tests… (attempt ${i}/${MAX_ITER})`);

    let runResult;
    try {
      runResult = await runInSandbox(e2bKey, files);
    } catch (err) {
      throw new Error(`Sandbox error: ${err.message}`);
    }

    const output = `${runResult.stdout}\n${runResult.stderr}`.trim();
    lastOutput = output;
    passed = runResult.exitCode === 0;

    iterationLog.push({
      iteration: i,
      exitCode: runResult.exitCode,
      output: output.slice(0, 1000),
      patches: [],
    });

    if (passed) break;
    if (i === MAX_ITER) break; // out of iterations

    // Tests failed — ask Claude for a fix
    if (onProgress) onProgress(`🔧 Tests failed — Claude is analysing and suggesting a fix… (attempt ${i}/${MAX_ITER})`);

    let fix;
    try {
      fix = await getFixFromClaude(anthropicKey, files, output, i, focus);
    } catch (err) {
      iterationLog[i - 1].claudeError = err.message;
      break;
    }

    iterationLog[i - 1].analysis = fix.analysis;
    iterationLog[i - 1].patches = fix.patches || [];

    if (!fix.patches || fix.patches.length === 0) {
      // Claude couldn't suggest a fix — stop iterating
      break;
    }

    files = applyPatches(files, fix.patches);
  }

  // Final review from Claude
  if (onProgress) onProgress('📝 Generating final review…');

  const { review, diff } = await getFinalReview(
    anthropicKey,
    repoData.repoId,
    originalFiles,
    files,
    iterations,
    lastOutput,
    passed,
    focus
  );

  return { review, diff, passed, iterations, finalOutput: lastOutput, iterationLog };
}

module.exports = { runAndIterate };
