require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID. Check your environment variables.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractMessageId(input) {
  const trimmed = input.trim();
  const linkMatch = trimmed.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d+)/i);
  if (linkMatch) return linkMatch[1];

  const idMatch = trimmed.match(/^\d{17,25}$/);
  if (idMatch) return trimmed;

  return null;
}

function isOlderThan14Days(message) {
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  return Date.now() - message.createdTimestamp > fourteenDaysMs;
}

const command = new SlashCommandBuilder()
  .setName('deletebefore')
  .setDescription('Delete all messages before a selected message in this channel.')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('Paste the message link or message ID.')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: [command.toJSON()],
  });
  console.log('Slash command registered.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
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

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: 'This command only works in normal text channels.',
      ephemeral: true,
    });
  }

  const botMember = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(botMember);

  if (
    !botPerms?.has(PermissionFlagsBits.ManageMessages) ||
    !botPerms?.has(PermissionFlagsBits.ReadMessageHistory) ||
    !botPerms?.has(PermissionFlagsBits.ViewChannel) ||
    !botPerms?.has(PermissionFlagsBits.SendMessages)
  ) {
    return interaction.reply({
      content:
        'I need these permissions in this channel: View Channel, Send Messages, Manage Messages, and Read Message History.',
      ephemeral: true,
    });
  }

  const input = interaction.options.getString('message', true);
  const targetMessageId = extractMessageId(input);

  if (!targetMessageId) {
    return interaction.reply({
      content: 'Invalid message link or message ID.',
      ephemeral: true,
    });
  }

  try {
    await channel.messages.fetch(targetMessageId);
  } catch (error) {
    return interaction.reply({
      content: 'I could not find that message in this channel. Make sure the link or ID belongs to this channel.',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content: 'Started deleting messages before the selected message. This may take time for old or large channels.',
    ephemeral: true,
  });

  let beforeId = targetMessageId;
  let deletedCount = 0;
  let failedCount = 0;
  let loops = 0;
  let lastProgressAt = Date.now();

  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, before: beforeId });
    if (fetched.size === 0) break;

    beforeId = fetched.last().id;

    const bulkDeletable = fetched.filter((msg) => !isOlderThan14Days(msg));
    const oldMessages = fetched.filter((msg) => isOlderThan14Days(msg));

    if (bulkDeletable.size > 0) {
      try {
        const deleted = await channel.bulkDelete(bulkDeletable, true);
        deletedCount += deleted.size;
        await sleep(1200);
      } catch (error) {
        for (const msg of bulkDeletable.values()) {
          try {
            await msg.delete();
            deletedCount++;
          } catch (_) {
            failedCount++;
          }
          await sleep(1200);
        }
      }
    }

    for (const msg of oldMessages.values()) {
      try {
        await msg.delete();
        deletedCount++;
      } catch (_) {
        failedCount++;
      }
      await sleep(1200);
    }

    loops++;
    if (Date.now() - lastProgressAt > 15000) {
      lastProgressAt = Date.now();
      await interaction.followUp({
        content: `Progress: deleted ${deletedCount} messages. Failed: ${failedCount}.`,
        ephemeral: true,
      }).catch(() => {});
    }

    if (loops > 100000) break;
  }

  await interaction.followUp({
    content: `Finished. Deleted ${deletedCount} messages before the selected message. Failed: ${failedCount}.`,
    ephemeral: true,
  }).catch(() => {});
});

(async () => {
  try {
    await registerCommands();
    await client.login(BOT_TOKEN);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
