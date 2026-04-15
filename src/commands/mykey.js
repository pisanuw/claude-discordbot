const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const db = require('../lib/db');

// The custom ID used to identify modal submissions from this command
const MODAL_ID = 'mykey_modal';
const INPUT_ID = 'api_key_input';

module.exports = {
  // Expose these IDs so interactionCreate.js can route modal submissions
  MODAL_ID,
  INPUT_ID,

  data: new SlashCommandBuilder()
    .setName('claude-mykey')
    .setDescription('Manage your personal Anthropic API key')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Store your own Anthropic API key (opens a private modal)')
    )
    .addSubcommand((sub) =>
      sub.setName('clear').setDescription('Remove your stored API key')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check whether you have a personal key stored')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /mykey set ────────────────────────────────────────────────────────────
    if (sub === 'set') {
      // Show a modal — the input is never visible in chat history
      const modal = new ModalBuilder()
        .setCustomId(MODAL_ID)
        .setTitle('Enter your Anthropic API key');

      const keyInput = new TextInputBuilder()
        .setCustomId(INPUT_ID)
        .setLabel('API key (starts with sk-ant-)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('sk-ant-api03-…')
        .setMinLength(20)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
      await interaction.showModal(modal);
      return;
    }

    // ── /mykey clear ──────────────────────────────────────────────────────────
    if (sub === 'clear') {
      if (!db.hasUserKey(interaction.user.id)) {
        await interaction.reply({
          content: 'ℹ️ You have no stored API key.',
          ephemeral: true,
        });
        return;
      }
      db.clearUserKey(interaction.user.id);
      await interaction.reply({
        content: '🗑️ Your API key has been removed. Claude requests will be blocked until you add another key with `/claude-mykey set`.',
        ephemeral: true,
      });
      return;
    }

    // ── /mykey status ─────────────────────────────────────────────────────────
    if (sub === 'status') {
      const hasKey = db.hasUserKey(interaction.user.id);
      await interaction.reply({
        content: hasKey
          ? '✅ You have a personal API key stored. Your requests use your key.'
          : '🔑 No personal key stored. Claude requests are disabled until you add one with `/claude-mykey set`.',
        ephemeral: true,
      });
    }
  },
};
