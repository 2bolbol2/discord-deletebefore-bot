# Discord Delete Before Bot

Bot command:

```text
/deletebefore message:MESSAGE_LINK_OR_ID
```

It deletes all messages before the selected message in the same channel.

## Required bot permissions

- View Channels
- Send Messages
- Manage Messages
- Read Message History
- Use Application Commands

## Required Discord Developer Portal settings

Go to your app > Bot > Privileged Gateway Intents and enable:

- Message Content Intent

## Setup

1. Install Node.js 18 or newer.
2. Rename `.env.example` to `.env`.
3. Fill in:

```env
BOT_TOKEN=your bot token
CLIENT_ID=your application/client ID
GUILD_ID=your server ID
```

4. Install dependencies:

```bash
npm install
```

5. Start the bot:

```bash
npm start
```

## Render setup

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Environment Variables in Render:

- BOT_TOKEN
- CLIENT_ID
- GUILD_ID

## Notes

- Messages newer than 14 days are deleted in bulk when possible.
- Messages older than 14 days are deleted one by one because Discord does not allow bulk delete for old messages.
- The command only works for users with Manage Messages permission.
- The target message itself will not be deleted. Only messages before it are removed.
