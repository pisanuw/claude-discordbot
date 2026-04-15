const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { fetchRepo } = require('../lib/github');
const { reviewRepo } = require('../lib/reviewer');
const db = require('../lib/db');

const DISCORD_MAX = 1900;

/** Split a long string into ≤DISCORD_MAX chunks, breaking on newlines where possible. */
function splitChunks(text, maxLen = DISCORD_MAX) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let breakAt = remaining.lastIndexOf('\n', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claude-review')
    .setDescription('Review a GitHub repository using Claude AI')
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('Public GitHub repository URL (e.g. https://github.com/owner/repo)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('focus')
        .setDescription('Optional: specific things to focus on (e.g. "Python style, error handling")')
        .setRequired(false)
        .setMaxLength(300)
    ),

  async execute(interaction) {
    const repoUrl = interaction.options.getString('url');
    const focus = interaction.options.getString('focus') || null;
    const userId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const apiKey = db.getUserKey(userId);
    if (!apiKey) {
      await interaction.editReply('❌ `/claude-review` requires your personal Anthropic API key. Set it with `/claude-mykey set`.');
      return;
    }

    // ── Step 1: Fetch repo ─────────────────────────────────────────────────
    await interaction.editReply('📥 Fetching repository…');

    let repoData;
    try {
      repoData = await fetchRepo(repoUrl);
    } catch (err) {
      await interaction.editReply(`❌ Could not fetch repository: ${err.message}`);
      return;
    }

    const truncationWarning = repoData.truncated
      ? '\n⚠️ Repository was large — only a subset of files was reviewed.'
      : '';

    await interaction.editReply(
      `📦 Fetched **${repoData.files.length}** file(s) from \`${repoData.repoId}\`${truncationWarning}\n🤖 Sending to Claude for review…`
    );

    // ── Step 2: AI review ──────────────────────────────────────────────────
    let review, diff;
    try {
      ({ review, diff } = await reviewRepo(
        apiKey,
        repoData,
        focus,
        (msg) => interaction.editReply(msg).catch(() => {})
      ));
    } catch (err) {
      const msg = err.status === 401
        ? '❌ API key rejected.'
        : err.status === 429
        ? '⏳ Rate limit hit — please try again shortly.'
        : `❌ Claude API error: ${err.message}`;
      await interaction.editReply(msg);
      return;
    }

    // ── Step 3: Post review text ───────────────────────────────────────────
    const header = `## 📋 Code Review — \`${repoData.repoId}\`\n`;
    const reviewChunks = splitChunks(header + review);

    await interaction.editReply(reviewChunks[0]);
    for (let i = 1; i < reviewChunks.length; i++) {
      await interaction.followUp({ content: reviewChunks[i], ephemeral: true });
    }

    // ── Step 4: Post diff as a file attachment (if any) ────────────────────
    if (diff) {
      const patchContent = `# Suggested changes for ${repoData.repoId} (branch: ${repoData.branch})\n# Apply with: git apply changes.patch\n\n${diff}`;
      const attachment = new AttachmentBuilder(
        Buffer.from(patchContent, 'utf8'),
        { name: 'changes.patch', description: 'Suggested code changes — apply with git apply changes.patch' }
      );

      await interaction.followUp({
        content:
          '📎 **Suggested changes** (unified diff)\n' +
          'Apply to your repo with:\n```bash\ngit apply changes.patch\n```',
        files: [attachment],
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: '✅ No specific code changes suggested — see the review above for guidance.',
        ephemeral: true,
      });
    }
  },
};
