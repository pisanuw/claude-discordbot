require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');

// ── Validate required env vars ───────────────────────────────────────────────
const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ENCRYPTION_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[bot] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ── Create Discord client ────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required to read message text for @mentions
  ],
});

// ── Load commands ────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`[bot] Loaded command: /${command.data.name}`);
  }
}

// ── Load events ──────────────────────────────────────────────────────────────
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  const fn = (...args) => event.execute(...args);
  if (event.once) {
    client.once(event.name, fn);
  } else {
    client.on(event.name, fn);
  }
  console.log(`[bot] Registered event: ${event.name}${event.once ? ' (once)' : ''}`);
}

// ── Start ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
