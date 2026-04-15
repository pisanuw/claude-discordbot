const { SlashCommandBuilder } = require('discord.js');

const HELP_TEXT = `**ClaudeBot — Commands**

\`/claude-ask <prompt>\` — Send a private message to Claude. Maintains per-user conversation history.
\`/claude-reset\` — Clear your conversation history.
\`/claude-mykey set|clear|status\` — Manage your personal Anthropic API key.
\`/claude-e2bkey set|clear|status\` — Manage your personal E2B API key (for sandboxed code execution).
\`/claude-review <url> [focus]\` — Review a public GitHub repository. Returns a written review and a \`changes.patch\` diff file.
\`/claude-run <url> [focus]\` — Fetch a GitHub repo, run tests in a sandbox, auto-fix failures, then return a review and patch.
\`/claude-github-setup\` — Instructions for setting up GitHub Actions CI in your repository.

All slash-command replies are private. Mentioning the bot in a channel is public and replies in the channel.

**When a personal API key is required:**
Every Claude request requires your personal Anthropic key. Set it with \`/claude-mykey set\` (starts with \`sk-ant-\`). Keys are stored encrypted and only used for your requests. \`/claude-run\` additionally requires your personal E2B key — set it with \`/claude-e2bkey set\`.

**GitHub review workflow:**
1. \`/claude-review url:<github-url>\` — Claude fetches the repo, reviews the code, and returns a written report.
2. If improvements are found, a \`changes.patch\` file is attached.
3. Apply it locally: \`git apply changes.patch\`
4. To also run and fix tests automatically, use \`/claude-run\` instead (requires E2B key).

You can also mention the bot directly with any message: \`@ClaudeBot <your question>\`. Mention-based prompts and replies stay in the channel.`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claude-help')
    .setDescription('List all ClaudeBot commands and usage instructions'),

  async execute(interaction) {
    await interaction.reply({ content: HELP_TEXT, ephemeral: true });
  },
};
