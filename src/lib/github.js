/**
 * GitHub repo fetcher — uses the public REST API (no auth required for public repos).
 * Optionally uses GITHUB_TOKEN for higher rate limits (5000 req/hr vs 60 req/hr).
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

// File extensions considered reviewable source code
const REVIEWABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.java', '.kt', '.swift', '.go',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs', '.php', '.rs',
  '.html', '.css', '.scss', '.sass',
  '.json', '.yaml', '.yml', '.toml',
  '.sh', '.bash',
  '.md', '.txt',
  '.sql',
  'Makefile', 'Dockerfile',
]);

// Always skip these paths
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'env', 'dist', 'build', '.next', '.nuxt', 'coverage',
  '.pytest_cache', 'vendor',
]);

const MAX_FILE_SIZE_BYTES = 60_000;  // skip files larger than this
const MAX_TOTAL_CHARS = 80_000;     // cap total content sent to Claude
const MAX_FILES = 40;               // cap number of files fetched

function githubHeaders() {
  const h = { 'User-Agent': 'discord-claude-bot' };
  if (GITHUB_TOKEN) h['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

/**
 * Parse a GitHub URL into { owner, repo, branch? }
 * Supports:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 */
function parseGithubUrl(url) {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], branch: match[3] || null };
}

/**
 * Determine the default branch for a repo.
 */
async function getDefaultBranch(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return data.default_branch;
}

/**
 * Fetch the recursive file tree for a repo at a given branch/SHA.
 * Returns a flat array of { path, url, size } for reviewable files.
 */
async function getFileTree(owner, repo, branch) {
  const treeUrl =
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(treeUrl, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  const data = await res.json();

  return (data.tree || [])
    .filter((item) => {
      if (item.type !== 'blob') return false;
      // Skip large files
      if (item.size > MAX_FILE_SIZE_BYTES) return false;
      // Skip ignored directories
      const parts = item.path.split('/');
      if (parts.some((p) => SKIP_DIRS.has(p))) return false;
      // Check extension or exact filename
      const ext = item.path.includes('.')
        ? '.' + item.path.split('.').pop()
        : item.path.split('/').pop();
      return REVIEWABLE_EXTENSIONS.has(ext);
    })
    .slice(0, MAX_FILES)
    .map((item) => ({
      path: item.path,
      size: item.size,
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${branch}`,
    }));
}

/**
 * Fetch the decoded text content of a single file.
 */
async function getFileContent(fileUrl) {
  const res = await fetch(fileUrl, { headers: githubHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

/**
 * Fetch a repo and return structured content ready for Claude.
 *
 * @returns {{ repoId, branch, files: Array<{path, content}>, truncated: boolean }}
 */
async function fetchRepo(githubUrl) {
  const parsed = parseGithubUrl(githubUrl);
  if (!parsed) throw new Error('Could not parse GitHub URL. Expected: https://github.com/owner/repo');

  const { owner, repo } = parsed;
  const branch = parsed.branch || await getDefaultBranch(owner, repo);

  const fileList = await getFileTree(owner, repo, branch);
  if (fileList.length === 0) {
    throw new Error('No reviewable source files found in this repository.');
  }

  const files = [];
  let totalChars = 0;
  let truncated = false;

  for (const file of fileList) {
    if (totalChars >= MAX_TOTAL_CHARS) { truncated = true; break; }
    const content = await getFileContent(file.url);
    if (!content) continue;
    if (totalChars + content.length > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    files.push({ path: file.path, content });
    totalChars += content.length;
  }

  return { repoId: `${owner}/${repo}`, branch, files, truncated };
}

module.exports = { fetchRepo, parseGithubUrl };
