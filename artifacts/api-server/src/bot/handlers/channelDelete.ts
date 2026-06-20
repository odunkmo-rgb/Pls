import {
  type Client,
  Events,
  AuditLogEvent,
  Colors,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  type PermissionOverwriteData,
} from "discord.js";
import { isExemptExecutor, isExemptRoleOnly, recordAction } from "../utils/actionTracker.js";
import { buildEmbed, sendLog } from "../utils/logger.js";
import { CONFIG } from "../config.js";

interface DeletedChannelData {
  name: string;
  type: ChannelType;
  position: number;
  parentId: string | null;
  topic: string | null;
  nsfw: boolean;
  permissionOverwrites: PermissionOverwriteData[];
  guildId: string;
}

const deletedChannelCache = new Map<string, DeletedChannelData>();

export function registerChannelDelete(client: Client): void {
  client.on(Events.ChannelDelete, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    const guild = channel.guild;

    const channelName = "name" in channel ? channel.name : "Bilinmeyen";
    const channelType = channel.type;
    const position = "position" in channel ? (channel.position as number) : 0;
    const parentId = "parentId" in channel ? (channel.parentId as string | null) : null;
    const topic = "topic" in channel ? (channel.topic as string | null) : null;
    const nsfw = "nsfw" in channel ? (channel.nsfw as boolean) : false;
    const permissionOverwrites =
      "permissionOverwrites" in channel
        ? (channel as TextChannel).permissionOverwrites.cache.map((ow) => ({
            id: ow.id,
            type: ow.type,
            allow: ow.allow,
            deny: ow.deny,
          }))
        : [];

    deletedChannelCache.set(channel.id, {
      name: channelName,
      type: channelType,
      position,
      parentId,
      topic,
      nsfw,
      permissionOverwrites,
      guildId: guild.id,
    });

    if (deletedChannelCache.size > 50) {
      const firstKey = deletedChannelCache.keys().next().value;
      if (firstKey) deletedChannelCache.delete(firstKey);
    }

    await new Promise((r) => setTimeout(r, 1000));

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 1,
      });

      const entry = auditLogs.entries.first();
      if (!entry || !entry.executor) return;

      const timeDiff = Date.now() - entry.createdTimestamp;
      if (timeDiff > 5000) return;

      const executor = entry.executor;
      if (executor.id === client.user?.id) return;

      let member: GuildMember | null = null;
      try {
        member = await guild.members.fetch(executor.id);
      } catch {
        return;
      }

      // LOG KANALI SİLİNDİYSE: ban + DM + geri yükle
      if (channel.id === CONFIG.LOG_CHANNEL_ID) {
        const alertEmbed = buildEmbed({
          title: "🚨 LOG KANALI SİLİNDİ — OTOMATİK GERİ YÜKLENDİ",
          description: `Log kanalını <@${executor.id}> silmeye çalıştı. **Otomatik banlandı ve kanal geri yüklendi.**`,
          color: Colors.DarkRed,
          fields: [
            { name: "Kim Yaptı", value: `${executor.tag ?? executor.id} (<@${executor.id}>)`, inline: false },
            { name: "Sunucu", value: guild.name, inline: true },
          ],
        });

        // Bak, banla
        try { await guild.members.ban(executor.id, { reason: "Log kanalını sildi — otomatik ban" }); } catch { /* ignore */ }

        // 3 kişiye DM
        for (const userId of CONFIG.ALLOWED_USER_IDS) {
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [alertEmbed] });
          } catch { /* ignore */ }
        }

        // Log kanalını yeniden oluştur
        try {
          const logChannelData = deletedChannelCache.get(channel.id);
          if (logChannelData) {
            const { ChannelType: CT } = await import("discord.js");
            await guild.channels.create({
              name: logChannelData.name,
              type: logChannelData.type as
                | 0 | 2 | 4 | 5 | 13 | 15,
              permissionOverwrites: logChannelData.permissionOverwrites,
            });
            deletedChannelCache.delete(channel.id);
          }
        } catch (err) { console.error("log channel restore error:", err); }

        return;
      }

      const exempt = isExemptExecutor(executor.id, member.roles.cache.map((r) => r.id));

      if (exempt) {
        const logChannel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);
        if (logChannel instanceof TextChannel) {
          const restoreButton = new ButtonBuilder()
            .setCustomId(`restore_channel_${channel.id}`)
            .setLabel("Kanalı Geri Yükle")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🔄");
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(restoreButton);
          await logChannel.send({
            embeds: [buildEmbed({
              title: "🗑️ Kanal Silindi",
              description: `**#${channelName}** kanalı silindi.`,
              color: Colors.Yellow,
              fields: [
                { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
                { name: "Durum", value: "Muaf — yaptırım uygulanmadı", inline: false },
              ],
            })],
            components: [row],
          });
        }
        if (isExemptRoleOnly(executor.id, member.roles.cache.map((r) => r.id))) {
          try {
            await member.send(
              `📋 **Bilgi:** **#${channelName}** kanalını sildin. Bu işlem kayıt altına alındı. Muaf olduğun için herhangi bir yaptırım uygulanmadı.`,
            );
          } catch { /* DM kapalı */ }
        }
        return;
      }

      const { exceeded, warning, count } = recordAction(
        executor.id,
        "channelDelete",
        channel.id,
      );

      const restoreButton = new ButtonBuilder()
        .setCustomId(`restore_channel_${channel.id}`)
        .setLabel("Kanalı Geri Yükle")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🔄");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(restoreButton);

      const logEmbed = buildEmbed({
        title: "🗑️ Kanal Silindi",
        description: `**#${channelName}** kanalı silindi.`,
        color: Colors.Yellow,
        fields: [
          { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
          { name: "İşlem Sayısı", value: `${count}/3`, inline: true },
          { name: "Kanal ID", value: channel.id, inline: true },
        ],
      });

      const logChannel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);
      if (logChannel instanceof TextChannel) {
        await logChannel.send({ embeds: [logEmbed], components: [row] });
      }

      if (warning) {
        await sendLog(
          guild,
          buildEmbed({
            title: "⚠️ UYARI — Son Hak",
            description: `<@${executor.id}> **2. kanal silme** işlemini yaptı. Bir tane daha silerse yetkileri alınacak!`,
            color: Colors.Yellow,
            fields: [{ name: "Uyarı", value: "Tek hakkın var!" }],
          }),
        );
        try { await member.send("⚠️ **Uyarı:** 2. kanalı sildin. Bir tane daha silersen yönetici yetkilerin alınacak!"); } catch { /* ignore */ }
      }

      if (exceeded) {
        const adminRoles = member.roles.cache.filter(
          (r) =>
            r.permissions.has(PermissionFlagsBits.Administrator) ||
            r.permissions.has(PermissionFlagsBits.ManageChannels) ||
            r.permissions.has(PermissionFlagsBits.BanMembers) ||
            r.permissions.has(PermissionFlagsBits.KickMembers),
        );

        for (const [, role] of adminRoles) {
          try {
            await member.roles.remove(role, "Güvenlik: İşlem limiti aşıldı");
          } catch { /* ignore */ }
        }

        await sendLog(
          guild,
          buildEmbed({
            title: "🚨 YETKİ ALINDI — Limit Aşıldı",
            description: `<@${member.id}> 3. kanalı sildi. Yönetici rolleri alındı.`,
            color: Colors.DarkRed,
            fields: [
              {
                name: "Alınan Roller",
                value: adminRoles.size > 0 ? adminRoles.map((r) => r.name).join(", ") : "Yok",
              },
            ],
          }),
        );
        try { await member.send("🚨 **Yetkilerin alındı!** Kanal silme limitini aştığın için yönetici rollerin kaldırıldı."); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error("channelDelete handler error:", err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("restore_channel_")) return;
    if (!interaction.guild) return;

    const isAllowed = CONFIG.ALLOWED_USER_IDS.includes(interaction.user.id);
    if (!isAllowed) {
      await interaction.reply({
        content: "Bu butonu kullanma yetkiniz yok.",
        ephemeral: true,
      });
      return;
    }

    const channelId = interaction.customId.replace("restore_channel_", "");
    const data = deletedChannelCache.get(channelId);

    if (!data) {
      await interaction.reply({
        content: "Bu kanal için önbellekte veri bulunamadı. Bot yeniden başlatılmış olabilir.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const guild = interaction.guild;

      const createOptions: Parameters<typeof guild.channels.create>[0] = {
        name: data.name,
        type: data.type as
          | ChannelType.GuildText
          | ChannelType.GuildVoice
          | ChannelType.GuildCategory
          | ChannelType.GuildAnnouncement
          | ChannelType.GuildStageVoice
          | ChannelType.GuildForum,
        position: data.position,
        permissionOverwrites: data.permissionOverwrites,
      };

      if (data.parentId) createOptions.parent = data.parentId;
      if (
        data.type === ChannelType.GuildText ||
        data.type === ChannelType.GuildAnnouncement
      ) {
        if (data.topic) (createOptions as { topic?: string }).topic = data.topic;
        (createOptions as { nsfw?: boolean }).nsfw = data.nsfw;
      }

      await guild.channels.create(createOptions);
      deletedChannelCache.delete(channelId);

      await interaction.editReply({
        content: `✅ **#${data.name}** kanalı başarıyla geri yüklendi.`,
      });

      await interaction.message.edit({ components: [] }).catch(() => null);

      await sendLog(
        guild,
        buildEmbed({
          title: "✅ Kanal Geri Yüklendi",
          description: `**#${data.name}** kanalı <@${interaction.user.id}> tarafından geri yüklendi.`,
          color: Colors.Green,
          fields: [{ name: "Geri Yükleyen", value: `<@${interaction.user.id}>`, inline: true }],
        }),
      );
    } catch (err) {
      console.error("channel restore error:", err);
      await interaction.editReply({
        content: "❌ Kanal geri yüklenirken bir hata oluştu. Bot'un gerekli izinleri var mı?",
      });
    }
  });
}
