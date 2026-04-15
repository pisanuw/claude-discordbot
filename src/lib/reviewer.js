const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

/**
 * Build the prompt payload sent to Claude.
 */
function buildPrompt(repoId, branch, files, truncated, extraInstructions) {
  const fileBlock = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const truncationNote = truncated
    ? '\n\n> ⚠️ Note: The repository was large. Only the first files up to the token limit were included.'
    : '';

  return `You are an expert code reviewer. A student has submitted the GitHub repository \`${repoId}\` (branch: \`${branch}\`) for review.${truncationNote}

${extraInstructions ? `**Reviewer instructions:** ${extraInstructions}\n\n` : ''}Here are the repository files:

${fileBlock}

---

Please produce TWO sections:

## 1. Review

Write a clear, constructive, student-friendly code review. Cover:
- Overall structure and design
- Correctness issues or bugs
- Code quality (readability, naming, comments)
- Best practices and potential improvements
- Any security or performance concerns

Be specific — reference file names and line numbers where relevant.

## 2. Suggested Changes (Unified Diff)

Produce a unified diff (\`git diff\` format) containing all suggested edits.
- Use \`--- a/<filepath>\` and \`+++ b/<filepath>\` headers
- Include 3 lines of context around each change
- Only include files that actually need changes
- If no code changes are warranted, write: \`No diff required.\`

Output the diff inside a fenced code block with the \`diff\` language tag.`;
}

/**
 * Parse Claude's response into { review, diff }.
 * diff may be null if Claude found no changes needed.
 */
function parseResponse(text) {
  // Extract diff block
  const diffMatch = text.match(/```diff\n([\s\S]*?)```/);
  const diff = diffMatch ? diffMatch[1].trim() : null;

  // Strip the diff block from the review text
  const review = text
    .replace(/## 2\..*$/s, '')
    .replace(/```diff[\s\S]*?```/g, '')
    .trim();

  return {
    review,
    diff: diff === 'No diff required.' ? null : diff,
  };
}

/**
 * Run a full AI review of a fetched repo.
 *
 * @param {string}   apiKey           - Anthropic API key
 * @param {object}   repoData         - Output of fetchRepo()
 * @param {string}   extraInstructions - Optional reviewer focus instructions
 * @param {Function} onProgress       - Called with status strings during processing
 * @returns {{ review: string, diff: string|null }}
 */
async function reviewRepo(apiKey, repoData, extraInstructions, onProgress) {
  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(
    repoData.repoId,
    repoData.branch,
    repoData.files,
    repoData.truncated,
    extraInstructions
  );

  if (onProgress) onProgress(`🔍 Reviewing ${repoData.files.length} files…`);

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return parseResponse(text);
}

module.exports = { reviewRepo };
