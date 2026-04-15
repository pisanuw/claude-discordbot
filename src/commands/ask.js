const { SlashCommandBuilder } = require('discord.js');
const { handleQuery } = require('../lib/handler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claude-ask')
    .setDescription('Send a message to Claude')
    .addStringOption((opt) =>
      opt
        .setName('prompt')
        .setDescription('What do you want to ask Claude?')
        .setRequired(true)
        .setMaxLength(2000)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    // Acknowledge immediately — Anthropic calls can take several seconds
    await interaction.deferReply({ ephemeral: true });

    await handleQuery(
      interaction.user.id,
      prompt,
      (text) => interaction.editReply(text),
      (text) => interaction.followUp({ content: text, ephemeral: true })
    );
  },
};
