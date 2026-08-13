# Discord Role Sync

A one-shot command-line tool that adds or removes a Discord role for every user
who reacted to a specific message or voted in that message's native Discord
poll. It runs locally, logs every decision, and exits—it is **not** a
continuously running bot.

## Features

- Supports ordinary and super emoji reactions plus every answer in a native
  Discord poll.
- Deduplicates users who reacted more than once or voted and reacted.
- Paginates beyond Discord's 100-user API page size.
- Handles `ADD` and `REMOVE` safely and skips users already in the desired state.
- Skips users who have left the server instead of crashing the run.
- Keeps the bot token in the environment; secrets never need to appear in shell history.
- Offers `--dry-run`, optional bot-user inclusion, automatic channel discovery,
  and an explicit channel override for predictable large-server runs.
- Continues after an individual member update fails and returns a non-zero exit
  status if any update failed.

## Requirements

- Node.js 20.19 or newer.
- A Discord application with a bot installed in the target server.
- Bot permissions:
  - View Channels
  - Read Message History
  - Manage Roles
- The bot's highest role must be above the role it will manage.

The bot also needs the **Message Content** privileged gateway intent so Discord
includes a native poll in the fetched message. Enable it under
`Bot → Privileged Gateway Intents` in the Developer Portal. Unverified apps can
usually toggle it directly; verified apps may need Discord approval.

## Setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Add a bot, reset/copy its token, and keep the token private.
3. On the Bot page, enable **Message Content Intent**.
4. Under OAuth2 URL Generator, select the `bot` scope and the permissions listed
   above. Open the generated URL to install the bot in your test server.
5. Move the bot's role above the role you want it to manage.
6. Enable Developer Mode in Discord (`Settings → Advanced → Developer Mode`).
   Right-click the server, message, role, and preferably channel to copy their IDs.
7. Install dependencies and create a local environment file:

   ```bash
   npm install
   cp .env.example .env
   ```

8. Fill in `.env`. It is ignored by Git and must never be committed:

   ```dotenv
   DISCORD_TOKEN=your-private-bot-token
   DISCORD_GUILD_ID=123456789012345678
   DISCORD_MESSAGE_ID=223456789012345678
   DISCORD_ROLE_ID=323456789012345678
   DISCORD_ACTION=ADD
   DISCORD_CHANNEL_ID=423456789012345678
   ```

## Usage

Preview the changes (this is also the default when no mode flag is supplied):

```bash
npm start -- --dry-run
```

Apply the action configured in `.env` only after reviewing the preview:

```bash
npm start -- --apply
```

Override non-secret values for one run:

```bash
npm start -- \
  --guild-id 123456789012345678 \
  --channel-id 423456789012345678 \
  --message-id 223456789012345678 \
  --role-id 323456789012345678 \
  --action REMOVE \
  --apply
```

Run `npm start -- --help` for every option. The bot token intentionally has no
command-line flag, which keeps it out of process lists and shell history.

If `DISCORD_CHANNEL_ID`/`--channel-id` is omitted, the tool searches accessible
message channels in the server. Supplying the channel is faster and is required
for some thread messages.

## Expected output

```text
Collected participants from 3 reaction source(s) across 2 emoji(s)
Collected participants from 3 poll answer(s)
Found 7 unique participant(s)
[ADD] ada (111111111111111111); source: normal reaction ✅, poll answer 1
[SKIP] lin (222222222222222222) — already has the role; source: super reaction 🎉
Done: 6 changed, 1 unchanged, 0 no longer in server, 0 failed (from 7 participant(s)).
```

## Safety and troubleshooting

- Always start with `--dry-run`.
- Never paste a bot token into an issue, chat, screenshot, video, or commit. If
  one leaks, reset it immediately in the Developer Portal.
- `Missing Permissions` normally means the bot lacks **Manage Roles** or its
  highest role is not above the target role.
- `Unknown Message` normally means the channel ID is wrong or the bot cannot
  view/read that channel.
- A user who left the server is logged as `SKIP`; that is expected.
- The `@everyone` role and integration-managed roles cannot be changed.
- Role updates are sequential so discord.js can respect Discord's rate limits.

## Development

```bash
npm run verify
```

For a submission-quality recording, follow the uncut test-server walkthrough in
[docs/DEMO.md](docs/DEMO.md). It demonstrates reaction and poll union, preview,
ADD, REMOVE, and repeat-run idempotency without exposing the token.

## AI assistance disclosure

This implementation was substantially created with OpenAI Codex (GPT-5) acting
on behalf of the repository owner. The public submission must retain this
disclosure. A human operator must review the code, run the tests, perform the
Discord demo, and take responsibility for the submitted work.

## License

MIT. See [LICENSE](LICENSE).
