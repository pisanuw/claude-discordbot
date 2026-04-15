const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const db = require('../lib/db');

const MODAL_ID = 'e2bkey_modal';
const INPUT_ID = 'e2b_key_input';

module.exports = {
  MODAL_ID,
  INPUT_ID,

  data: new SlashCommandBuilder()
    .setName('claude-e2bkey')
    .setDescription('Manage your personal E2B API key for sandboxed code execution')
    .addSubcommand((sub) =>
      sub.setName('set').setDescription('Store your E2B API key (opens a private modal)')
    )
    .addSubcommand((sub) =>
      sub.setName('clear').setDescription('Remove your stored E2B API key')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check whether you have a personal E2B key stored')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const modal = new ModalBuilder()
        .setCustomId(MODAL_ID)
        .setTitle('Enter your E2B API key');

      const keyInput = new TextInputBuilder()
        .setCustomId(INPUT_ID)
        .setLabel('E2B API key (from e2b.dev/dashboard)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e2b_…')
        .setMinLength(10)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
      await interaction.showModal(modal);
      return;
    }

    if (sub === 'clear') {
      if (!db.hasUserE2BKey(interaction.user.id)) {
        await interaction.reply({ content: 'ℹ️ You have no stored E2B key.', ephemeral: true });
        return;
      }
      db.clearUserE2BKey(interaction.user.id);
      await interaction.reply({
        content: '🗑️ Your E2B key has been removed. `/claude-run` will be blocked until you add another key with `/claude-e2bkey set`.',
        ephemeral: true,
      });
      return;
    }

    if (sub === 'status') {
      const hasKey = db.hasUserE2BKey(interaction.user.id);
      await interaction.reply({
        content: hasKey
          ? '✅ You have a personal E2B key stored. Your `/run` requests use your sandbox quota.'
          : '🔑 No personal E2B key stored. `/claude-run` is disabled until you add one with `/claude-e2bkey set`.',
        ephemeral: true,
      });
    }
  },
};
