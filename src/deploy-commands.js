require('dotenv').config();

const { REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('[deploy] DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (cmd.data) commands.push(cmd.data.toJSON());
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`[deploy] Registering ${commands.length} global slash command(s)…`);
    const data = await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log(`[deploy] ✅ Registered ${data.length} command(s) globally.`);
    console.log('[deploy] Note: Global commands can take up to 1 hour to propagate.');
    console.log('[deploy] For instant updates during development, use guild-scoped registration (see README).');
  } catch (err) {
    console.error('[deploy] Failed:', err);
    process.exit(1);
  }
})();
