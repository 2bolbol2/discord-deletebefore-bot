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

function parseMessageInput(input) {
  const text = String(input || '').trim();

  const urlMatch = text.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (urlMatch) {
    return {
      guildId: urlMatch[1],
      channelId: urlMatch[2],
      messageId: urlMatch[3],
      isLink: true,
    };
  }

  const idMatch = text.match(/\d{17,22}/);
  if (idMatch) {
    return {
      guildId: null,
      channelId: null,
      messageId: idMatch[0],
      isLink: false,
    };
  }

  return null;
}

async function safeEdit(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    console.log(`Could not update Discord reply: ${err.code || err.name} ${err.message}`);
  }
}

function canDeleteMessage(msg) {
  if (!msg?.deletable) return false;
  return true;
}

async function deleteOneMessage(msg) {
  try {
    if (!canDeleteMessage(msg)) {
      return { ok: false, reason: 'Not deletable' };
    }

    await msg.delete();
    return { ok: true, reason: 'Deleted' };
  } catch (err) {
    return {
      ok: false,
      reason: `${err.code || err.name || 'Error'} ${err.message || ''}`.trim(),
    };
  }
}

async function deleteMessages(interaction, mode, targetInput) {
  // Important: this function is called only after deferReply().
  if (running) {
    await safeEdit(interaction, 'يوجد حذف شغال حاليًا. استخدم /stopdelete أولًا.');
    return;
  }

  const parsed = parseMessageInput(targetInput);
  if (!parsed?.messageId) {
    await safeEdit(interaction, 'ضع Message ID صحيح أو رابط رسالة صحيح.');
    return;
  }

  if (parsed.channelId && parsed.channelId !== interaction.channelId) {
    await safeEdit(interaction, 'رابط الرسالة من قناة مختلفة. استخدم الأمر داخل نفس القناة التي تريد الحذف منها.');
    return;
  }

  const memberPerms = interaction.memberPermissions;
  if (!memberPerms?.has(PermissionFlagsBits.ManageMessages)) {
    await safeEdit(interaction, 'تحتاج صلاحية Manage Messages.');
    return;
  }

  const channel = interaction.channel;
  const botMember = interaction.guild?.members?.me;
  const botPerms = channel.permissionsFor(botMember);

  if (
    !botPerms?.has(PermissionFlagsBits.ViewChannel) ||
    !botPerms?.has(PermissionFlagsBits.ReadMessageHistory) ||
    !botPerms?.has(PermissionFlagsBits.ManageMessages)
  ) {
    await safeEdit(interaction, 'البوت يحتاج في هذه القناة: View Channel + Read Message History + Manage Messages.');
    return;
  }

  running = true;
  stopRequested = false;

  let deleted = 0;
  let failed = 0;
  let scanned = 0;
  let pages = 0;
  let cursor = parsed.messageId;
  let lastProgress = Date.now();

  await safeEdit(
    interaction,
    `بدأ الحذف ${mode === 'before' ? 'قبل' : 'بعد'} الرسالة:\n${parsed.messageId}\n\nلا تقفل Termux.`
  );

  console.log(`Started ${mode} deletion in #${channel.name || channel.id}, target=${parsed.messageId}`);

  try {
    while (!stopRequested) {
      const options = { limit: 100 };
      if (mode === 'before') options.before = cursor;
      if (mode === 'after') options.after = cursor;

      let batch;
      try {
        batch = await channel.messages.fetch(options);
      } catch (err) {
        console.error(`Fetch failed: ${err.code || err.name} ${err.message}`);
        await safeEdit(interaction, `فشل جلب الرسائل: ${err.message}`);
        break;
      }

      if (!batch || batch.size === 0) {
        console.log('No more messages to scan.');
        break;
      }

      pages++;

      let messages = [...batch.values()];

      if (mode === 'before') {
        // Newest -> oldest. Cursor becomes oldest message in the page.
        messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
        cursor = messages[messages.length - 1].id;
      } else {
        // Oldest -> newest. Cursor becomes newest message in the page.
        messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));
        cursor = messages[messages.length - 1].id;
      }

      for (const msg of messages) {
        if (stopRequested) break;

        scanned++;

        // Never delete the command response if Discord returns it in the page.
        if (msg.id === interaction.id || msg.id === parsed.messageId) {
          continue;
        }

        const result = await deleteOneMessage(msg);
        if (result.ok) {
          deleted++;
          console.log(`Deleted ${msg.id} | Total deleted: ${deleted}`);
        } else {
          failed++;
          console.log(`Skipped ${msg.id}: ${result.reason}`);
        }

        // Slow enough for old messages and mobile Termux stability.
        await sleep(1000);

        if (Date.now() - lastProgress > 5000) {
          await safeEdit(
            interaction,
            `جاري الحذف...\nتم الحذف: ${deleted}\nفشل/تخطّي: ${failed}\nتم فحص: ${scanned}\nصفحات: ${pages}`
          );
          lastProgress = Date.now();
        }
      }

      // Small pause between pages.
      await sleep(1500);
    }

    await safeEdit(
      interaction,
      `${stopRequested ? 'تم إيقاف العملية.' : 'اكتملت العملية.'}\nتم الحذف: ${deleted}\nفشل/تخطّي: ${failed}\nتم فحص: ${scanned}\nصفحات: ${pages}`
    );
  } catch (err) {
    console.error('Main delete error:', err);
    await safeEdit(interaction, `حصل خطأ رئيسي: ${err.message}`);
  } finally {
    console.log(`Finished. deleted=${deleted}, failed=${failed}, scanned=${scanned}, pages=${pages}`);
    running = false;
    stopRequested = false;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('deletebefore')
    .setDescription('Delete all messages before a specific message in this channel')
    .addStringOption((o) =>
      o.setName('message').setDescription('Message ID or message link').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('deleteafter')
    .setDescription('Delete all messages after a specific message in this channel')
    .addStringOption((o) =>
      o.setName('message').setDescription('Message ID or message link').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('stopdelete')
    .setDescription('Stop the current delete operation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands registered: /deletebefore /deleteafter /stopdelete');
} catch (err) {
  console.error('Failed registering commands:', err);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'stopdelete') {
      if (!running) {
        await interaction.reply({ content: 'لا توجد عملية حذف شغالة.', ephemeral: true });
        return;
      }

      stopRequested = true;
      await interaction.reply({ content: 'تم طلب إيقاف عملية الحذف. انتظر قليلًا.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'deletebefore' || interaction.commandName === 'deleteafter') {
      // Critical fix: acknowledge the interaction immediately.
      await interaction.deferReply({ ephemeral: false });

      const mode = interaction.commandName === 'deletebefore' ? 'before' : 'after';
      const messageInput = interaction.options.getString('message', true);

      await deleteMessages(interaction, mode, messageInput);
    }
  } catch (err) {
    console.error('Interaction error:', err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`حصل خطأ: ${err.message}`);
      } else {
        await interaction.reply({ content: `حصل خطأ: ${err.message}`, ephemeral: true });
      }
    } catch {}
  }
});

client.login(TOKEN);
