# Discord Delete Before Bot

Slash command:

/deletebefore

Paste a Discord message link or Message ID. The bot deletes all messages before that message in the same channel.

## Required bot permissions
- View Channel
- Send Messages
- Manage Messages
- Read Message History
- Use Application Commands

## Required environment variables
- BOT_TOKEN
- CLIENT_ID
- GUILD_ID

## Termux
```bash
pkg install nodejs-lts git -y
git clone https://github.com/YOUR_USERNAME/discord-deletebefore-bot.git
cd discord-deletebefore-bot
npm install
BOT_TOKEN="YOUR_NEW_TOKEN" CLIENT_ID="YOUR_APPLICATION_ID" GUILD_ID="YOUR_SERVER_ID" npm start
```
