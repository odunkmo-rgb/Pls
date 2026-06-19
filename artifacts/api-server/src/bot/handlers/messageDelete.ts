import {
  type Client,
  Events,
  Colors,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  AuditLogEvent,
  type APIEmbed,
  type APIActionRowComponent,
  type APIMessageActionRowComponent,
} from "discord.js";
import { CONFIG } from "../config.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

interface CachedMessage {
  content: string;
  authorId: string;
  authorTag: string;
  channelId: string;
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIMessageActionRowComponent>[];
  attachmentUrls: string[];
}

const messageCache = new Map<string, CachedMessage>();
const restoredMessageIds = new Set<string>();

async function dmAllowed(
  client: Client,
  guildId: string,
  embed: EmbedBuilder,
): Promise<void> {
  for (const userId of CONFIG.ALLOWED_USER_IDS) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
    } catch { /* DM kapalıysa geç */ }
  }
}

export function registerMessageDelete(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!CONFIG.PROTECTED_CHANNEL_IDS.includes(message.channelId)) return;
    if (restoredMessageIds.has(message.id)) return;

    messageCache.set(message.id, {
      content: message.content,
      authorId: message.author.id,
      authorTag: message.author.tag,
      channelId: message.channelId,
      embeds: message.embeds.map((e) => e.toJSON()),
      components: message.components.map((row) => row.toJSON()),
      attachmentUrls: message.attachments.map((a) => a.url),
    });

    if (messageCache.size > 500) {
      const firstKey = messageCache.keys().next().value;
      if (firstKey) messageCache.delete(firstKey);
    }
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!CONFIG.PROTECTED_CHANNEL_IDS.includes(message.channelId)) return;
    if (!message.guild) return;
    if (restoredMessageIds.has(message.id)) {
      restoredMessageIds.delete(message.id);
      return;
    }

    const guild = message.guild;
    const cached = messageCache.get(message.id);
    messageCache.delete(message.id);

    // Kim sildi? Audit log'dan bul
    let deletorId: string | null = null;
    let deletorTag: string | null = null;
    try {
      await new Promise((r) => setTimeout(r, 800));
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MessageDelete,
        limit: 5,
      });
      const entry = auditLogs.entries.find((e) => {
        if (!e.executor) return false;
        if ((e.extra as { channel?: { id?: string } })?.channel?.id !== message.channelId) return false;
        return Date.now() - e.createdTimestamp < 10000;
      });
      if (entry?.executor) {
        deletorId = entry.executor.id;
        deletorTag = entry.executor.tag;
      }
    } catch { /* audit log erişilemedi */ }

    try {
      const channel = await guild.channels.fetch(message.channelId);
      if (!channel || !(channel instanceof TextChannel)) return;

      if (cached) {
        const restoreEmbeds: EmbedBuilder[] = [];

        if (cached.embeds.length > 0) {
          for (const e of cached.embeds) {
            restoreEmbeds.push(EmbedBuilder.from(e));
          }
        } else if (cached.content) {
          restoreEmbeds.push(
            new EmbedBuilder()
              .setDescription(cached.content)
              .setColor(Colors.Grey)
              .setFooter({ text: `Gönderen: ${cached.authorTag}` })
              .setTimestamp(),
          );
        }

        if (restoreEmbeds.length > 0 || cached.attachmentUrls.length > 0) {
          const sendOptions: Parameters<typeof channel.send>[0] = {};
          if (restoreEmbeds.length > 0) sendOptions.embeds = restoreEmbeds;
          if (cached.attachmentUrls.length > 0) sendOptions.content = cached.attachmentUrls.join("\n");
          if (cached.components.length > 0) {
            sendOptions.components = cached.components.map((row) =>
              ActionRowBuilder.from<ButtonBuilder>(row),
            );
          }
          const sent = await channel.send(sendOptions);
          restoredMessageIds.add(sent.id);
        }
      }

      const isLogChannel = message.channelId === CONFIG.LOG_CHANNEL_ID;
      const alertTitle = isLogChannel
        ? "🚨 LOG KANALI MESAJI SİLİNDİ"
        : "🚨 KORUNAN KANALDAN MESAJ SİLİNDİ";

      const alertEmbed = buildEmbed({
        title: alertTitle,
        description: cached
          ? `**Gönderen:** <@${cached.authorId}> tarafından yazılan mesaj silindi ve otomatik geri yüklendi.`
          : "Önbelleğe alınmamış bir mesaj silindi (geri yüklenemedi).",
        color: Colors.DarkRed,
        fields: [
          { name: "Kanal", value: `<#${message.channelId}>`, inline: true },
          { name: "Sunucu", value: guild.name, inline: true },
          ...(cached
            ? [{ name: "Mesajı Yazan", value: `${cached.authorTag} (<@${cached.authorId}>)`, inline: false }]
            : []),
          ...(deletorId && deletorId !== cached?.authorId
            ? [{ name: "🗑️ Kim Sildi", value: `${deletorTag ?? deletorId} (<@${deletorId}>)`, inline: false }]
            : deletorId
            ? [{ name: "🗑️ Kim Sildi", value: "Kendi mesajını sildi", inline: false }]
            : [{ name: "🗑️ Kim Sildi", value: "Belirlenemedi", inline: false }]),
          ...(cached?.components.length
            ? [{ name: "Butonlar", value: "Geri yüklendi ✅", inline: true }]
            : []),
        ],
      });

      await sendLog(guild, alertEmbed);
      await dmAllowed(client, guild.id, alertEmbed);
    } catch (err) {
      console.error("messageDelete restore error:", err);
    }
  });
}
