# Discord Claude Bot

A Discord bot that lets server members chat with Claude AI. Supports slash commands, `@mention` triggering, per-user persistent conversation history, and required personal Anthropic and E2B keys for the features that use them.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create a Discord Application & Bot](#1-create-a-discord-application--bot)
3. [Get an Anthropic API Key](#2-get-an-anthropic-api-key)
4. [Local Setup](#3-local-setup)
5. [Deploy to Railway](#4-deploy-to-railway)
6. [Register Slash Commands](#5-register-slash-commands)
7. [Configuration Reference](#6-configuration-reference)
8. [User Guide — Commands & Usage](#7-user-guide--commands--usage)
9. [Architecture Notes](#8-architecture-notes)
10. [Security Notes](#9-security-notes)
11. [Troubleshooting](#10-troubleshooting)

---

## Prerequisites

- **Node.js 18+** (for local development)
- A **Discord account** with permission to add bots to a server
- A **Railway account** (free tier) for deployment

---

## 1. Create a Discord Application & Bot

### 1a. Create the application

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g. "Claude Bot") → **Create**
3. Note the **Application ID** on the General Information page — this is your `DISCORD_CLIENT_ID`

### 1b. Create the bot user

1. In the left sidebar, click **Bot**
2. Click **Add Bot** → **Yes, do it!**
3. Under **Token**, click **Reset Token** → copy and save it — this is your `DISCORD_TOKEN`
   > ⚠️ Never commit this token to version control. Treat it like a password.
4. Scroll down to **Privileged Gateway Intents** and enable:
   - **Message Content Intent** ✅ (required for @mention reading)

### 1c. Invite the bot to your server

1. In the left sidebar, click **OAuth2 → URL Generator**
2. Under **Scopes**, check: `bot`, `applications.commands`
3. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Read Message History`
   - `Use Slash Commands`
   - `Read Messages/View Channels`
4. Copy the generated URL, open it in your browser, and invite the bot to your server

---

## 2. User API Keys

> **Important:** The Anthropic API and your Claude.ai Pro subscription are **separate products** with separate billing.
>
> - **Claude.ai Pro** ($20/mo) gives you access to the claude.ai website and apps.
> - The **Anthropic API** charges per token used and requires an API key from [console.anthropic.com](https://console.anthropic.com).
>
> This bot uses the API. Each user needs an API key from the console regardless of Pro subscription status.

Each user should do the following before using Claude features:

1. Go to [https://console.anthropic.com](https://console.anthropic.com) and sign in
2. Navigate to **API Keys** → **Create Key**
3. Copy the key — it starts with `sk-ant-`
4. Set up a **spending limit** under Billing → Usage Limits to avoid unexpected charges
5. In Discord, run `/claude-mykey set` and paste the key into the private modal

Users who want `/claude-run` must also create an E2B key from [https://e2b.dev/dashboard](https://e2b.dev/dashboard) and store it with `/claude-e2bkey set`.

### Rough cost estimate

Using `claude-sonnet-4-6` (default):
- $3 per million input tokens, $15 per million output tokens
- A typical chat message exchange: ~500–2000 tokens
- 1000 messages/month ≈ $5–15 depending on length

---

## 3. Local Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/discord-claude-bot.git
cd discord-claude-bot

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
ENCRYPTION_KEY=  # see below
```

**Generate your ENCRYPTION_KEY:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `ENCRYPTION_KEY` in your `.env`.

**Register slash commands** (required before the bot responds to `/ask` etc.):

```bash
node src/deploy-commands.js
```

**Start the bot:**

```bash
npm start
```

You should see:
```
[bot] Loaded command: /ask
[bot] Loaded command: /claude-reset
[bot] Loaded command: /mykey
[bot] Registered event: ready (once)
[bot] Registered event: messageCreate
[bot] Registered event: interactionCreate
[bot] Logged in as Claude Bot#1234
```

---

## 4. Deploy to Railway

Railway provides $5/month of free credit — more than enough for an always-on Discord bot.

### 4a. Push the code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/discord-claude-bot.git
git push -u origin main
```

### 4b. Create the Railway project

1. Go to [https://railway.app](https://railway.app) → **New Project**
2. Select **Deploy from GitHub repo** → choose your repository
3. Railway will detect Node.js and start building automatically

### 4c. Add a persistent volume (for SQLite)

The bot stores conversation history in a SQLite file. Without a persistent volume, data is lost on every redeploy.

1. In your Railway project, click your service → **Volumes** tab
2. Click **Add Volume**
3. Set the mount path to `/data`
4. Click **Add**

### 4d. Set environment variables

In Railway: click your service → **Variables** tab → add each variable:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your bot token |
| `DISCORD_CLIENT_ID` | Your application ID |
| `ENCRYPTION_KEY` | 64-char hex string (same one from local setup) |
| `DB_PATH` | `/data/bot.db` |

Optional:

| Variable | Default | Notes |
|---|---|---|
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Or `claude-opus-4-6` for the most capable model |
| `MAX_TOKENS` | `2048` | Max tokens per Claude response |

### 4e. Trigger a redeploy

After adding the volume and variables, click **Redeploy** (or push a commit). Railway will restart the bot with the new config.

### 4f. Check logs

In Railway: **Deployments** → click the latest → **View Logs**. You should see the same startup lines as local.

---

## 5. Register Slash Commands

Slash commands must be registered with Discord's API. You only need to do this once (or after adding new commands).

**From your local machine** (with your `.env` set up):

```bash
node src/deploy-commands.js
```

> Global commands take **up to 1 hour** to propagate to all servers.
>
> **For faster testing during development**, register commands to a specific guild (server) instead. In `deploy-commands.js`, replace:
> ```js
> Routes.applicationCommands(DISCORD_CLIENT_ID)
> ```
> with:
> ```js
> Routes.applicationGuildCommands(DISCORD_CLIENT_ID, 'YOUR_GUILD_ID')
> ```
> Guild commands propagate instantly.

---

## 6. Configuration Reference

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application ID from the Discord Developer Portal |
| `ENCRYPTION_KEY` | ✅ | 64-char hex key for AES-256-GCM encryption of user keys |
| `DB_PATH` | | SQLite file path (default: `/data/bot.db` on Railway, `./bot.db` locally) |
| `CLAUDE_MODEL` | | Claude model string (default: `claude-sonnet-4-6`) |
| `MAX_TOKENS` | | Max tokens per response (default: `2048`) |
| `GITHUB_TOKEN` | | GitHub personal access token — raises rate limit from 60 to 5000 req/hr. Recommended if you use `/review` frequently. Create a fine-grained token with **read-only Contents** scope at github.com → Settings → Developer settings. |

---

## 7. User Guide — Commands & Usage

### `/ask <prompt>`

Ask Claude a question or start a conversation.

```
/ask What is the difference between TCP and UDP?
/ask Can you help me debug this Python function?
```

Claude remembers your conversation history across all servers and sessions — it's global to your Discord user ID. Use `/claude-reset` to start fresh.

---

### `@BotName <message>`

Mention the bot directly in any channel it has access to. Works the same as `/ask`.

```
@Claude Bot What are some good ways to learn Rust?
```

There is a **3-second cooldown** per user on mentions to prevent spam.

---

### `/claude-reset`

Clears your entire conversation history. Claude will have no memory of previous exchanges on your next message.

```
/claude-reset
```

This only affects your history — other users are unaffected.

---

### `/claude-mykey set`

Register your own Anthropic API key. This is required before you can use Claude chat or review features.

```
/claude-mykey set
```

A private modal dialog opens — type or paste your key there. The input is **never visible in chat**. Keys are stored encrypted (AES-256-GCM) in the database.

> Your key must start with `sk-ant-`. Get one from [console.anthropic.com](https://console.anthropic.com).

---

### `/claude-mykey status`

Check whether you have a personal key stored.

```
/claude-mykey status
→ ✅ You have a personal API key stored.
```

---

### `/claude-mykey clear`

Remove your stored API key. Claude requests will stop working until you store another key.

```
/claude-mykey clear
```

---

### `/claude-e2bkey set`

Register your own E2B API key. This is required before you can use `/claude-run`.

```
/claude-e2bkey set
```

---


### `/review <url> [focus]`

Submit a public GitHub repository for an AI code review. Claude fetches the source files, analyses them, and returns:

1. **A written review** posted directly in Discord — covering structure, correctness, code quality, best practices, and security
2. **A `changes.patch` file attachment** — a unified diff of all suggested edits, applied with `git apply changes.patch`

**Examples:**

```
/review url:https://github.com/student/assignment1
/review url:https://github.com/student/project focus:Python style and error handling
```

**Applying the patch:**

```bash
git apply changes.patch        # apply suggested changes
git apply --check changes.patch  # preview without applying
```

**Limits:** up to 40 files, ~80k characters total. Binary files, node_modules, dist, and .git are excluded automatically. Private repos require GITHUB_TOKEN.

---

### Response behaviour

- Responses stream in live — you'll see the text appear progressively
- If a response exceeds Discord's 2000-character limit, it is automatically split into multiple messages
- Responses from Claude use the full conversation history (last 40 messages)

---

## 8. Architecture Notes

```
src/
├── index.js              Entry point — loads commands/events, starts client
├── deploy-commands.js    One-time script to register slash commands with Discord API
├── commands/
│   ├── ask.js            /ask slash command
│   ├── reset.js          /claude-reset slash command
│   └── mykey.js          /mykey set|clear|status + modal definition
├── events/
│   ├── ready.js          Fires once on login
│   ├── messageCreate.js  @mention trigger with cooldown
│   └── interactionCreate.js  Routes slash commands + handles modal submission
└── lib/
    ├── claude.js         Anthropic SDK wrapper — streaming chat
    ├── db.js             SQLite layer — history + encrypted user keys
    └── handler.js        Shared query logic used by both triggers
```

**Conversation storage:** SQLite with WAL mode. History is keyed by Discord `user_id` only (global, not guild-scoped). The last 40 messages are sent to Claude on each request.

**Key encryption:** AES-256-GCM with a random 96-bit IV per write. The authentication tag is stored alongside the ciphertext, preventing silent corruption or tampering.

**Streaming:** The Anthropic SDK's streaming API is used. Discord replies are edited every ~1.5 seconds with accumulated text, then finalised when the stream closes.

---

## 9. Security Notes

- **Never commit `.env`** — it's in `.gitignore`
- **Rotate `ENCRYPTION_KEY` with care:** changing it invalidates all stored user keys (users will need to re-enter them with `/claude-mykey set` and `/claude-e2bkey set`)
- **User API keys** are stored encrypted at rest; the plaintext key only exists in memory during a request
- `/claude-mykey set` and `/claude-e2bkey set` use Discord modals, so the keys are never posted in chat and never appear in server audit logs
- If your Discord bot token is ever exposed, **reset it immediately** in the Developer Portal

---

## 10. Troubleshooting

**Bot is online but slash commands don't appear**
- Run `node src/deploy-commands.js` and wait up to 1 hour for global propagation
- For instant results, use guild-scoped registration (see §5)

**`Error: Missing Access` when the bot tries to reply**
- Make sure the bot has `Send Messages` and `Read Message History` permissions in the channel

**Bot can't read @mention messages**
- Confirm **Message Content Intent** is enabled in the Discord Developer Portal → Bot page

**`[db] WARNING: ENCRYPTION_KEY not set`**
- Generate a key and add it to your env vars (see §3)

**User keys not persisting after redeploy on Railway**
- Ensure the volume is mounted at `/data` and `DB_PATH=/data/bot.db` is set

**Claude returns 401 errors**
- The API key is invalid or revoked — check [console.anthropic.com](https://console.anthropic.com)
- If a user set a personal key, they should `/claude-mykey clear`, then `/claude-mykey set` with a valid key
