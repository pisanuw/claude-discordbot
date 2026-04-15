const db = require('./db');
const { streamChat } = require('./claude');

const DISCORD_MAX = 1900; // leave headroom below the 2000-char hard limit
const EDIT_INTERVAL_MS = 1500; // throttle live edits to ~1 per 1.5 s

/**
 * Split a long string into chunks that fit within Discord's message limit.
 * Tries to break on newlines when possible.
 */
function splitIntoChunks(text, maxLen = DISCORD_MAX) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Prefer breaking at the last newline within the window
    let breakAt = remaining.lastIndexOf('\n', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = maxLen; // no good break point
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

/**
 * Core handler for a user prompt.
 *
 * @param {string}   userId    - Discord user ID (global, not guild-scoped).
 * @param {string}   prompt    - The user's message text.
 * @param {Function} editReply - Async function that edits the bot's placeholder reply.
 *                               Receives a string; returns a Promise.
 * @param {Function} followUp  - Async function to send additional messages (overflow chunks).
 *                               Receives a string; returns a Promise.
 */
async function handleQuery(userId, prompt, editReply, followUp) {
  const apiKey = db.getUserKey(userId);

  if (!apiKey) {
    await editReply(
      '❌ No Anthropic API key configured for your account. Register one with `/claude-mykey set` before using Claude.'
    );
    return;
  }

  // Build message array: history + new user turn
  const history = db.getHistory(userId);
  const messages = [...history, { role: 'user', content: prompt }];

  // Live-edit the placeholder while tokens stream in
  let lastEditTime = Date.now();
  let latestText = '';

  const onChunk = (accumulated) => {
    latestText = accumulated;
    const now = Date.now();
    if (now - lastEditTime >= EDIT_INTERVAL_MS) {
      lastEditTime = now;
      // Show a typing cursor during streaming; ignore edit errors (rate limits etc.)
      editReply(accumulated.slice(0, DISCORD_MAX) + ' ▌').catch(() => {});
    }
  };

  let finalText;
  try {
    finalText = await streamChat(apiKey, messages, onChunk);
  } catch (err) {
    const msg = buildErrorMessage(err);
    await editReply(msg);
    return;
  }

  // Persist the exchange
  db.appendMessage(userId, 'user', prompt);
  db.appendMessage(userId, 'assistant', finalText);

  // Send the final response, splitting if needed
  const chunks = splitIntoChunks(finalText);
  await editReply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await followUp(chunks[i]);
  }
}

function buildErrorMessage(err) {
  if (err.status === 401) {
    return (
      '❌ **API key rejected.** If you set a personal key with `/claude-mykey set`, ' +
      'it may be invalid — use `/claude-mykey clear` and try again.'
    );
  }
  if (err.status === 429) {
    return '⏳ **Rate limit hit.** Please wait a moment and try again.';
  }
  if (err.status >= 500) {
    return '⚠️ **Anthropic API is temporarily unavailable.** Try again in a minute.';
  }
  return `❌ **Error:** ${err.message ?? 'Unknown error'}`;
}

module.exports = { handleQuery };
