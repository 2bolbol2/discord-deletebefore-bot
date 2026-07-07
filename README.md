# Discord Delete Before Bot v3

## Commands
- `/deletebefore message:<Message ID or Link>`
- `/deleteafter message:<Message ID or Link>`
- `/stopdelete`

## Termux Run
```bash
cd ~/discord-deletebefore-bot
npm install
BOT_TOKEN="NEW_TOKEN" CLIENT_ID="APPLICATION_ID" GUILD_ID="SERVER_ID" npm start
```

Bot permissions required in the channel:
- View Channel
- Read Message History
- Manage Messages
