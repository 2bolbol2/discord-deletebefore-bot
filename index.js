import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID');
  process.exit(1);
}

let stopRequested = false;
let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMessageId(input) {
  const text = String(input || '').trim();
  const urlMatch = text.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = text.match(/\d{17,22}/);
  return idMatch ? idMatch[0] : null;
}

async function safeEdit(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
  } catch {}
}

async function deleteMessages(interaction, mode, targetInput) {
  if (running) {
    return interaction.reply({ content: 'يوجد حذف شغال حاليًا. استخدم /stopdelete أولًا.', ephemeral: true });
  }

  const targetId = extractMessageId(targetInput);
  if (!targetId) {
    return interaction.reply({ content: 'ضع Message ID صحيح أو رابط رسالة صحيح.', ephemeral: true });
  }

  const memberPerms = interaction.memberPermissions;
  if (!memberPerms?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: 'تحتاج صلاحية Manage Messages.', ephemeral: true });
  }

  const channel = interaction.channel;
  const botMember = interaction.guild.members.me;
  const botPerms = channel.permissionsFor(botMember);
  if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.ReadMessageHistory) || !botPerms?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: 'البوت يحتاج في هذه القناة: View Channel + Read Message History + Manage Messages.', ephemeral: true });
  }

  running = true;
  stopRequested = false;
  await interaction.deferReply({ ephemeral: false });
  await safeEdit(interaction, `بدأ الحذف ${mode === 'before' ? 'قبل' : 'بعد'} الرسالة: ${targetId}\nلا تقفل Termux.`);

  let deleted = 0;
  let failed = 0;
  let scanned = 0;
  let lastProgress = Date.now();

  try {
    if (mode === 'before') {
      let before = targetId;
      while (!stopRequested) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (batch.size === 0) break;

        const ordered = [...batch.values()];
        before = ordered[ordered.length - 1].id;

        for (const msg of ordered) {
          if (stopRequested) break;
          scanned++;
          try {
            await msg.delete();
            deleted++;
            console.log(`Deleted ${msg.id} | Total: ${deleted}`);
          } catch (err) {
            failed++;
            console.log(`Skipped ${msg.id}: ${err.code || err.name} ${err.message}`);
          }
          await sleep(900);
        }

        if (Date.now() - lastProgress > 5000) {
          await safeEdit(interaction, `جاري الحذف...\nتم الحذف: ${deleted}\nفشل/تخطّي: ${failed}\nتم فحص: ${scanned}`);
          lastProgress = Date.now();
        }
      }
    } else {
      let after = targetId;
      while (!stopRequested) {
        const batch = await channel.messages.fetch({ limit: 100, after });
        if (batch.size === 0) break;

        const ordered = [...batch.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? 1 : -1);
        after = ordered[ordered.length - 1].id;

        for (const msg of ordered) {
          if (stopRequested) break;
          scanned++;
          try {
            await msg.delete();
            deleted++;
            console.log(`Deleted ${msg.id} | Total: ${deleted}`);
          } catch (err) {
            failed++;
            console.log(`Skipped ${msg.id}: ${err.code || err.name} ${err.message}`);
          }
          await sleep(900);
        }

        if (Date.now() - lastProgress > 5000) {
          await safeEdit(interaction, `جاري الحذف...\nتم الحذف: ${deleted}\nفشل/تخطّي: ${failed}\nتم فحص: ${scanned}`);
          lastProgress = Date.now();
        }
      }
    }

    await safeEdit(interaction, `${stopRequested ? 'تم إيقاف العملية.' : 'اكتملت العملية.'}\nتم الحذف: ${deleted}\nفشل/تخطّي: ${failed}\nتم فحص: ${scanned}`);
  } catch (err) {
    console.error(err);
    await safeEdit(interaction, `حصل خطأ رئيسي: ${err.message}`);
  } finally {
    running = false;
    stopRequested = false;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('deletebefore')
    .setDescription('Delete all messages before a specific message in this channel')
    .addStringOption(o => o.setName('message').setDescription('Message ID or message link').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('deleteafter')
    .setDescription('Delete all messages after a specific message in this channel')
    .addStringOption(o => o.setName('message').setDescription('Message ID or message link').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('stopdelete')
    .setDescription('Stop the current delete operation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
try {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands registered: /deletebefore /deleteafter /stopdelete');
} catch (err) {
  console.error('Failed registering commands:', err);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'deletebefore') {
    return deleteMessages(interaction, 'before', interaction.options.getString('message'));
  }

  if (interaction.commandName === 'deleteafter') {
    return deleteMessages(interaction, 'after', interaction.options.getString('message'));
  }

  if (interaction.commandName === 'stopdelete') {
    if (!running) return interaction.reply({ content: 'لا توجد عملية حذف شغالة.', ephemeral: true });
    stopRequested = true;
    return interaction.reply({ content: 'تم طلب إيقاف عملية الحذف. انتظر قليلًا.', ephemeral: true });
  }
});

client.login(TOKEN);
