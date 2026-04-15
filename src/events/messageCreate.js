const { handleQuery } = require('../lib/handler');

// Simple per-user cooldown to avoid runaway API calls
const cooldowns = new Map(); // userId → timestamp
const COOLDOWN_MS = 3000;

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bots and messages that don't mention this bot
    if (message.author.bot) return;
    if (!message.mentions.has(message.client.user)) return;

    // Strip the mention(s) from the message content
    const prompt = message.content
      .replace(/<@!?\d+>/g, '')
      .trim();

    if (!prompt || prompt.toLowerCase() === 'help') {
      await message.reply('Mention me with a question, or use `/claude-help` for a list of commands. Slash-command replies are private.');
      return;
    }

    // Enforce cooldown
    const userId = message.author.id;
    const lastUsed = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_MS - (Date.now() - lastUsed);
    if (remaining > 0) {
      await message.reply(`⏳ Please wait ${(remaining / 1000).toFixed(1)}s before sending another message.`);
      return;
    }
    cooldowns.set(userId, Date.now());

    // Show typing indicator while we wait for Claude
    await message.channel.sendTyping();

    // Send placeholder, then stream into it
    const placeholder = await message.reply('…');

    await handleQuery(
      userId,
      prompt,
      (text) => placeholder.edit(text),
      (text) => message.channel.send(text)
    );
  },
};
