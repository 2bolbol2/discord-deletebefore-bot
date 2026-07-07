const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variables.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractMessageId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/\d{17,22}/g);
  if (!match || match.length === 0) return null;
  return match[match.length - 1];
}

async function registerCommands() {
  const command = new SlashCommandBuilder()
    .setName('deletebefore')
    .setDescription('Delete all messages before a specific message in this channel.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Message link or Message ID')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON();

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: [command],
  });
  console.log('Slash command /deletebefore registered.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'deletebefore') return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({
      content: 'You need Manage Messages permission to use this command.',
      ephemeral: true,
    });
  }

  const botMember = interaction.guild.members.me;
  const channelPerms = interaction.channel.permissionsFor(botMember);

  if (!channelPerms?.has(PermissionFlagsBits.ManageMessages) || !channelPerms?.has(PermissionFlagsBits.ReadMessageHistory)) {
    return interaction.reply({
      content: 'I need Manage Messages and Read Message History permissions in this channel.',
      ephemeral: true,
    });
  }

  const input = interaction.options.getString('message', true);
  const targetMessageId = extractMessageId(input);

  if (!targetMessageId) {
    return interaction.reply({
      content: 'Invalid message link or Message ID.',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content: `Started deleting messages before: ${targetMessageId}\nKeep Termux open until I finish.`,
    ephemeral: true,
  });

  let beforeId = targetMessageId;
  let deleted = 0;
  let failed = 0;
  let loops = 0;

  try {
    while (true) {
      const batch = await interaction.channel.messages.fetch({
        limit: 100,
        before: beforeId,
      });

      if (batch.size === 0) break;

      const messages = [...batch.values()];

      for (const msg of messages) {
        try {
          await msg.delete();
          deleted++;
        } catch (error) {
          failed++;
          console.log(`Failed deleting ${msg.id}: ${error.message}`);
        }

        await sleep(1100);
      }

      beforeId = messages[messages.length - 1].id;
      loops++;

      if (loops % 2 === 0) {
        await interaction.editReply({
          content: `Still working... Deleted: ${deleted}, Failed: ${failed}`,
        }).catch(() => {});
      }
    }

    await interaction.editReply({
      content: `Finished. Deleted: ${deleted}, Failed: ${failed}`,
    }).catch(() => {});
  } catch (error) {
    console.error(error);
    await interaction.editReply({
      content: `Stopped because of an error. Deleted: ${deleted}, Failed: ${failed}. Error: ${error.message}`,
    }).catch(() => {});
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(BOT_TOKEN);
  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
})();
