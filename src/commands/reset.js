const { SlashCommandBuilder } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claude-reset')
    .setDescription('Clear your entire conversation history with Claude'),

  async execute(interaction) {
    const count = db.countMessages(interaction.user.id);

    if (count === 0) {
      await interaction.reply({
        content: '📭 You have no conversation history to clear.',
        ephemeral: true,
      });
      return;
    }

    db.clearHistory(interaction.user.id);

    await interaction.reply({
      content: `🗑️ Cleared **${count}** message${count === 1 ? '' : 's'} from your history. Claude will start fresh on your next message.`,
      ephemeral: true,
    });
  },
};
