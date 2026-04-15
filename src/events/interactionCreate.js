const { MODAL_ID: MYKEY_MODAL_ID, INPUT_ID: MYKEY_INPUT_ID } = require('../commands/mykey');
const { MODAL_ID: E2BKEY_MODAL_ID, INPUT_ID: E2BKEY_INPUT_ID } = require('../commands/e2bkey');
const db = require('../lib/db');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`[bot] Error in /${interaction.commandName}:`, err);
        const msg = { content: '❌ An unexpected error occurred.', ephemeral: true };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
      return;
    }

    // ── Modal submissions ─────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {

      // Anthropic key modal
      if (interaction.customId === MYKEY_MODAL_ID) {
        const rawKey = interaction.fields.getTextInputValue(MYKEY_INPUT_ID).trim();
        if (!rawKey.startsWith('sk-ant-')) {
          await interaction.reply({
            content: '❌ That doesn\'t look like a valid Anthropic API key (should start with `sk-ant-`). No key was saved.',
            ephemeral: true,
          });
          return;
        }
        db.setUserKey(interaction.user.id, rawKey);
        await interaction.reply({
          content: '✅ Your Anthropic API key has been saved and encrypted. Your requests will now use your personal key.',
          ephemeral: true,
        });
        return;
      }

      // E2B key modal
      if (interaction.customId === E2BKEY_MODAL_ID) {
        const rawKey = interaction.fields.getTextInputValue(E2BKEY_INPUT_ID).trim();
        if (rawKey.length < 10) {
          await interaction.reply({
            content: '❌ That doesn\'t look like a valid E2B API key. No key was saved.',
            ephemeral: true,
          });
          return;
        }
        db.setUserE2BKey(interaction.user.id, rawKey);
        await interaction.reply({
          content: '✅ Your E2B API key has been saved and encrypted. Your `/run` requests will use your sandbox quota.',
          ephemeral: true,
        });
      }
    }
  },
};
