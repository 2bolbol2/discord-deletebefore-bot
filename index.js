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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'calculating...';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function percentage(done, total) {
  if (!total || total <= 0) return '0%';
  return `${Math.min(100, Math.floor((done / total) * 100))}%`;
}

function calcEtaMs(done, total, startedAt) {
  if (!total || done <= 0 || done >= total) return 0;
  const elapsed = Date.now() - startedAt;
  const perItem = elapsed / done;
  return Math.ceil((total - done) * perItem);
}

function completionBlock({ deleted, failed, scanned, pages, durationMs, stopped = false }) {
  return `
====================================
${stopped ? '🛑 DELETE STOPPED' : '✅ DELETE COMPLETED'}
Deleted : ${deleted}
Skipped : ${failed}
Scanned : ${scanned}
Pages   : ${pages}
Duration: ${formatDuration(durationMs)}
====================================
`.trim();
}

function progressText({ mode, phase, deleted, failed, scanned, pages, targetId, targetUser, totalTargets, startedAt }) {
  const label =
    mode === 'before' ? 'حذف الرسائل قبل الرسالة' :
    mode === 'after' ? 'حذف الرسائل بعد الرسالة' :
    'حذف رسائل عضو محدد';

  const done = deleted + failed;
  const pct = phase === 'counting' ? 'يتم الحساب...' : percentage(done, totalTargets);
  const eta = phase === 'counting' ? 'يتم الحساب...' : formatDuration(calcEtaMs(done, totalTargets, startedAt));

  return [
    phase === 'counting' ? '🔎 **جاري حساب عدد الرسائل...**' : '🧹 **جاري الحذف...**',
    `العملية: ${label}`,
    targetId ? `Message ID: \`${targetId}\`` : null,
    targetUser ? `User: ${targetUser}` : null,
    `النسبة: **${pct}**`,
    `المتبقي تقريبًا: **${eta}**`,
    `إجمالي الرسائل المستهدفة: **${totalTargets ?? 'يتم الحساب...'}**`,
    `تم الحذف: **${deleted}**`,
    `فشل/تخطي: **${failed}**`,
    `تم فحص: **${scanned}**`,
    `صفحات: **${pages}**`,
    '',
    'لا تقفل Termux حتى تنتهي العملية.',
  ].filter(Boolean).join('\n');
}

async function safeInteractionEdit(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    }
  } catch (err) {
    console.log(`Could not update interaction reply: ${err.code || err.name} ${err.message}`);
  }
}

async function safeProgressEdit(progressMessage, content) {
  if (!progressMessage) return;
  try {
    await progressMessage.edit(content);
  } catch (err) {
    console.log(`Could not update progress message: ${err.code || err.name} ${err.message}`);
  }
}

async function safeProgressDelete(progressMessage) {
  if (!progressMessage) return;
  try {
    await progressMessage.delete();
  } catch (err) {
    console.log(`Could not delete progress message: ${err.code || err.name} ${err.message}`);
  }
}

async function checkPermissions(interaction) {
  const memberPerms = interaction.memberPermissions;
  if (!memberPerms?.has(PermissionFlagsBits.ManageMessages)) {
    return 'تحتاج صلاحية Manage Messages.';
  }

  const channel = interaction.channel;
  const botMember = interaction.guild.members.me;
  const botPerms = channel.permissionsFor(botMember);

  if (
    !botPerms?.has(PermissionFlagsBits.ViewChannel) ||
    !botPerms?.has(PermissionFlagsBits.ReadMessageHistory) ||
    !botPerms?.has(PermissionFlagsBits.ManageMessages) ||
    !botPerms?.has(PermissionFlagsBits.SendMessages)
  ) {
    return 'البوت يحتاج في هذه القناة: View Channel + Send Messages + Read Message History + Manage Messages.';
  }

  return null;
}

async function fetchBatch(channel, mode, cursor) {
  if (mode === 'after') return channel.messages.fetch({ limit: 100, after: cursor });
  if (cursor) return channel.messages.fetch({ limit: 100, before: cursor });
  return channel.messages.fetch({ limit: 100 });
}

function orderBatch(batch, mode) {
  const arr = [...batch.values()];
  if (mode === 'after') return arr.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));
  return arr;
}

async function preCountTargets({ channel, mode, targetId, targetUser, updateCounting }) {
  let totalTargets = 0;
  let scanned = 0;
  let pages = 0;
  let cursor = mode === 'after' ? targetId : (targetId || undefined);
  let lastUpdate = 0;

  while (!stopRequested) {
    const batch = await fetchBatch(channel, mode, cursor);
    if (batch.size === 0) break;

    pages++;
    const ordered = orderBatch(batch, mode);
    cursor = ordered[ordered.length - 1].id;

    for (const msg of ordered) {
      scanned++;
      if (!targetUser || msg.author.id === targetUser.id) totalTargets++;
    }

    if (Date.now() - lastUpdate > 5000) {
      lastUpdate = Date.now();
      await updateCounting({ totalTargets, scanned, pages });
    }
  }

  return { totalTargets, scanned, pages };
}

async function deleteMessages(interaction, mode, targetInput, targetUser = null) {
  if (running) {
    return interaction.reply({ content: 'يوجد حذف شغال حاليًا. استخدم /stopdelete أولًا.', ephemeral: true });
  }

  running = true;
  stopRequested = false;

  const startedAt = Date.now();
  let deleted = 0;
  let failed = 0;
  let scanned = 0;
  let pages = 0;
  let totalTargets = 0;
  let progressMessage = null;
  let lastProgress = 0;

  try {
    await interaction.deferReply({ ephemeral: true });

    const targetId = extractMessageId(targetInput);

    if ((mode === 'before' || mode === 'after') && !targetId) {
      await safeInteractionEdit(interaction, 'ضع Message ID صحيح أو رابط رسالة صحيح.');
      return;
    }

    const permissionError = await checkPermissions(interaction);
    if (permissionError) {
      await safeInteractionEdit(interaction, permissionError);
      return;
    }

    const channel = interaction.channel;
    const targetUserText = targetUser ? `<@${targetUser.id}>` : null;

    await safeInteractionEdit(interaction, 'بدأت العملية. سيتم إرسال عداد مؤقت في القناة، وسيتم حذفه عند الانتهاء.');

    progressMessage = await channel.send(progressText({
      mode,
      phase: 'counting',
      deleted,
      failed,
      scanned,
      pages,
      targetId,
      targetUser: targetUserText,
      totalTargets: null,
      startedAt,
    }));

    console.log(`Counting targets for ${mode} deletion in #${channel.name}, target=${targetId || 'latest'}, user=${targetUser?.id || 'none'}`);

    const countResult = await preCountTargets({
      channel,
      mode,
      targetId,
      targetUser,
      updateCounting: async ({ totalTargets: counted, scanned: countedScanned, pages: countedPages }) => {
        await safeProgressEdit(progressMessage, progressText({
          mode,
          phase: 'counting',
          deleted: 0,
          failed: 0,
          scanned: countedScanned,
          pages: countedPages,
          targetId,
          targetUser: targetUserText,
          totalTargets: counted,
          startedAt,
        }));
      },
    });

    totalTargets = countResult.totalTargets;
    console.log(`Count completed. Total targets: ${totalTargets}, scanned=${countResult.scanned}, pages=${countResult.pages}`);

    // Reset counters for actual delete phase.
    scanned = 0;
    pages = 0;
    lastProgress = 0;
    const deleteStartedAt = Date.now();

    const updateProgress = async (force = false) => {
      if (!force && Date.now() - lastProgress < 5000) return;
      lastProgress = Date.now();
      await safeProgressEdit(progressMessage, progressText({
        mode,
        phase: 'deleting',
        deleted,
        failed,
        scanned,
        pages,
        targetId,
        targetUser: targetUserText,
        totalTargets,
        startedAt: deleteStartedAt,
      }));
    };

    console.log(`Started ${mode} deletion in #${channel.name}, target=${targetId || 'latest'}, user=${targetUser?.id || 'none'}`);
    await updateProgress(true);

    let cursor = mode === 'after' ? targetId : (targetId || undefined);

    while (!stopRequested) {
      const batch = await fetchBatch(channel, mode, cursor);
      if (batch.size === 0) {
        console.log('No more messages to scan.');
        break;
      }

      pages++;
      const ordered = orderBatch(batch, mode);
      cursor = ordered[ordered.length - 1].id;

      for (const msg of ordered) {
        if (stopRequested) break;
        scanned++;

        if (targetUser && msg.author.id !== targetUser.id) {
          await updateProgress(false);
          continue;
        }

        try {
          await msg.delete();
          deleted++;
          console.log(`Deleted ${msg.id} | Total deleted: ${deleted}/${totalTargets}`);
        } catch (err) {
          failed++;
          console.log(`Skipped ${msg.id}: ${err.code || err.name} ${err.message}`);
        }

        await updateProgress(false);
        await sleep(900);
      }
    }

    await updateProgress(true);
    const summary = completionBlock({ deleted, failed, scanned, pages, durationMs: Date.now() - startedAt, stopped: stopRequested });
    console.log(summary);
    await safeInteractionEdit(interaction, `انتهت العملية.\n\`\`\`text\n${summary}\n\`\`\``);
  } catch (err) {
    failed++;
    console.error(err);
    const summary = completionBlock({ deleted, failed, scanned, pages, durationMs: Date.now() - startedAt, stopped: true });
    console.log(summary);
    await safeInteractionEdit(interaction, `حصل خطأ رئيسي: ${err.message}\n\`\`\`text\n${summary}\n\`\`\``);
  } finally {
    await safeProgressDelete(progressMessage);
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
    .setName('deleteuser')
    .setDescription('Delete messages from a specific user in this channel')
    .addUserOption(o => o.setName('user').setDescription('User whose messages will be deleted').setRequired(true))
    .addStringOption(o => o.setName('before').setDescription('Optional: scan messages before this Message ID or link').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('stopdelete')
    .setDescription('Stop the current delete operation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
try {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands registered: /deletebefore /deleteafter /deleteuser /stopdelete');
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

  try {
    if (interaction.commandName === 'deletebefore') {
      return deleteMessages(interaction, 'before', interaction.options.getString('message'));
    }

    if (interaction.commandName === 'deleteafter') {
      return deleteMessages(interaction, 'after', interaction.options.getString('message'));
    }

    if (interaction.commandName === 'deleteuser') {
      return deleteMessages(
        interaction,
        'user',
        interaction.options.getString('before'),
        interaction.options.getUser('user')
      );
    }

    if (interaction.commandName === 'stopdelete') {
      if (!running) return interaction.reply({ content: 'لا توجد عملية حذف شغالة.', ephemeral: true });
      stopRequested = true;
      return interaction.reply({ content: 'تم طلب إيقاف عملية الحذف. انتظر قليلًا.', ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
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
