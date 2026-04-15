const Anthropic = require('@anthropic-ai/sdk');

// Default model — override per-request or via env var.
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '2048', 10);

/**
 * Stream a chat completion from the Anthropic API.
 *
 * @param {string}   apiKey   - Anthropic API key to use for this request.
 * @param {Array}    messages - Full conversation history in Anthropic format.
 * @param {Function} onChunk  - Called with the accumulated text after each token.
 * @returns {Promise<string>} The complete assistant response.
 */
async function streamChat(apiKey, messages, onChunk) {
  const client = new Anthropic({ apiKey });
  let fullText = '';

  const stream = await client.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta'
    ) {
      fullText += event.delta.text;
      if (onChunk) onChunk(fullText);
    }
  }

  return fullText;
}

module.exports = { streamChat };
