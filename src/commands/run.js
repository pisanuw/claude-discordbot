const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { fetchRepo } = require('../lib/github');
const { runAndIterate } = require('../lib/iterate');
const db = require('../lib/db');

const DISCORD_MAX = 1900;

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
    .setName('claude-run')
    .setDescription('Fetch a GitHub repo, run its tests in a sandbox, auto-fix and iterate, then review')
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('Public GitHub repository URL')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('focus')
        .setDescription('Optional: specific areas to focus on (e.g. "error handling, edge cases")')
        .setRequired(false)
        .setMaxLength(300)
    ),

  async execute(interaction) {
    const repoUrl = interaction.options.getString('url');
    const focus   = interaction.options.getString('focus') || null;
    const userId  = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    // ── Resolve keys ─────────────────────────────────────────────────────────
    const anthropicKey = db.getUserKey(userId);
    const e2bKey       = db.getUserE2BKey(userId);

    if (!anthropicKey) {
      await interaction.editReply('❌ `/claude-run` requires your personal Anthropic API key. Set it with `/claude-mykey set`.');
      return;
    }
    if (!e2bKey) {
      await interaction.editReply('❌ `/claude-run` requires your personal E2B API key. Set it with `/claude-e2bkey set`.');
      return;
    }

    // ── Fetch repo ────────────────────────────────────────────────────────────
    await interaction.editReply('📥 Fetching repository…');

    let repoData;
    try {
      repoData = await fetchRepo(repoUrl);
    } catch (err) {
      await interaction.editReply(`❌ Could not fetch repository: ${err.message}`);
      return;
    }

    const truncationNote = repoData.truncated
      ? '\n⚠️ Repository is large — only a subset of files was loaded into the sandbox.'
      : '';

    await interaction.editReply(
      `📦 Fetched **${repoData.files.length}** file(s) from \`${repoData.repoId}\`${truncationNote}\n🔬 Starting sandbox…`
    );

    // ── Agentic run + iterate loop ────────────────────────────────────────────
    let result;
    try {
      result = await runAndIterate(
        anthropicKey,
        e2bKey,
        repoData,
        focus,
        (msg) => interaction.editReply(msg).catch(() => {})
      );
    } catch (err) {
      await interaction.editReply(`❌ Sandbox error: ${err.message}`);
      return;
    }

    const { review, diff, passed, iterations, finalOutput, iterationLog } = result;

    // ── Status header ─────────────────────────────────────────────────────────
    const statusEmoji = passed ? '✅' : '❌';
    const statusText  = passed
      ? `Tests **passed**${iterations > 1 ? ` after ${iterations} iteration${iterations === 1 ? '' : 's'}` : ''}`
      : `Tests **still failing** after ${iterations} iteration${iterations === 1 ? '' : 's'}`;

    const header = `## ${statusEmoji} Run Results — \`${repoData.repoId}\`\n${statusText}\n\n`;

    // ── Post review ───────────────────────────────────────────────────────────
    const reviewChunks = splitChunks(header + review);
    await interaction.editReply(reviewChunks[0]);
    for (let i = 1; i < reviewChunks.length; i++) {
      await interaction.followUp({ content: reviewChunks[i], ephemeral: true });
    }

    // ── Post final test output (truncated) ────────────────────────────────────
    const outputSnippet = finalOutput.slice(-1500).trim();
    if (outputSnippet) {
      await interaction.followUp({
        content: `**📋 Final test output:**\n\`\`\`\n${outputSnippet}\n\`\`\``,
        ephemeral: true,
      });
    }

    // ── Post diff as attachment ───────────────────────────────────────────────
    if (diff) {
      const patchHeader = `# Suggested fixes for ${repoData.repoId}\n# Generated after ${iterations} sandbox iteration(s)\n# Apply with: git apply changes.patch\n\n`;
      const attachment = new AttachmentBuilder(
        Buffer.from(patchHeader + diff, 'utf8'),
        { name: 'changes.patch' }
      );
      await interaction.followUp({
        content:
          '📎 **Suggested fixes** (unified diff)\n' +
          'Apply to your local repo:\n```bash\ngit apply changes.patch\n```',
        files: [attachment],
        ephemeral: true,
      });
    } else if (!passed) {
      await interaction.followUp({
        content: '⚠️ Claude could not determine a fix automatically. Check the review above and the test output for guidance.',
        ephemeral: true,
      });
    }

    // ── Post iteration log (ephemeral, for context) ───────────────────────────
    if (iterations > 1) {
      const log = iterationLog
        .map((it) =>
          `**Attempt ${it.iteration}** — exit code ${it.exitCode}` +
          (it.analysis ? `\n> ${it.analysis.slice(0, 200)}` : '') +
          (it.patches?.length ? `\n> Applied ${it.patches.length} patch(es)` : '')
        )
        .join('\n\n');

      await interaction.followUp({
        content: `**🔁 Iteration log:**\n${log}`,
        ephemeral: true,
      });
    }
  },
};
