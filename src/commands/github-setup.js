const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

// ── Public summary posted in channel ────────────────────────────────────────
const CHANNEL_SUMMARY = `## 🔧 GitHub Actions Setup

To enable automated code review for your repository, you need to add a CI workflow file.

**Quick steps:**
1. Create \`.github/workflows/ci.yml\` in your repository
2. Choose the template for your language (Python, Node.js, Java, or custom script)
3. Commit and push — the workflow runs automatically from then on
4. Check the **Actions** tab on GitHub to see results (✅ pass / ❌ fail)

Run \`/claude-github-setup\` to receive the full guide with templates privately.`;

// ── Full ephemeral guide ─────────────────────────────────────────────────────
const FULL_GUIDE_PART1 = `## 📖 GitHub Actions Setup — Full Guide

When your instructor triggers a \`/review\` on your repo, GitHub Actions will automatically clone your code, install dependencies, run your tests, and report results.

---

### Step 1: Create the workflow file

Create this file at exactly this path in your repo:
\`\`\`
.github/workflows/ci.yml
\`\`\`

---

### 🐍 Python template
\`\`\`yaml
name: CI
on:
  push:
    branches: ["main", "master"]
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - run: python -m pytest --tb=short -v
\`\`\``;

const FULL_GUIDE_PART2 = `### 🟨 Node.js template
\`\`\`yaml
name: CI
on:
  push:
    branches: ["main", "master"]
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npm test
\`\`\`

### ☕ Java (Maven) template
\`\`\`yaml
name: CI
on:
  push:
    branches: ["main", "master"]
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: "17"
          distribution: "temurin"
      - run: mvn test
\`\`\``;

const FULL_GUIDE_PART3 = `### 🐍 No test framework (run a script directly)
\`\`\`yaml
name: CI
on:
  push:
    branches: ["main", "master"]
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python main.py   # replace with your entry point
\`\`\`

---

### Step 2: Commit and push
\`\`\`bash
git add .github/workflows/ci.yml
git commit -m "Add CI workflow"
git push
\`\`\`

---

### Step 3: Check your results

- Go to your repo on github.com → click the **Actions** tab
- 🟡 Running  ✅ Passed  ❌ Failed
- Click any run to see full logs and which tests failed

---

### ✅ Checklist before sharing your repo URL
- \`.github/workflows/ci.yml\` exists at the repo root
- The file includes \`workflow_dispatch:\` under \`on:\`
- At least one test file exists
- All dependencies are in \`requirements.txt\` or \`package.json\`
- Actions tab shows ✅ after your last push

Once done, share your repo URL in Discord with \`/claude-review url:<your-repo-url>\``;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claude-github-setup')
    .setDescription('Get instructions for setting up GitHub Actions for automated code review'),

  async execute(interaction) {
    await interaction.reply({ content: CHANNEL_SUMMARY, ephemeral: true });
    await interaction.followUp({ content: FULL_GUIDE_PART1, ephemeral: true });
    await interaction.followUp({ content: FULL_GUIDE_PART2, ephemeral: true });
    await interaction.followUp({ content: FULL_GUIDE_PART3, ephemeral: true });
  },
};
