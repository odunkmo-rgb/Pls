import {
  type Client,
  Events,
  Colors,
  TextChannel,
  EmbedBuilder,
  type APIEmbed,
} from "discord.js";
import { CONFIG } from "../config.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

interface CachedMessage {
  content: string;
  authorId: string;
  authorTag: string;
  authorAvatar: string | null;
  channelId: string;
  embeds: APIEmbed[];
  attachmentUrls: string[];
}

const messageCache = new Map<string, CachedMessage>();
const restoredMessageIds = new Set<string>();

async function dmAdmins(
  client: Client,
  guildId: string,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const members = await guild.members.fetch();
    for (const [, member] of members) {
      const isAdmin = CONFIG.ADMIN_ROLE_IDS.some((id) =>
        member.roles.cache.has(id),
      );
      if (!isAdmin) continue;
      try {
        await member.send({ embeds: [embed] });
      } catch {
        // DM kapalıysa geç
      }
    }
  } catch {
    // ignore
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
      authorAvatar: message.author.displayAvatarURL(),
      channelId: message.channelId,
      embeds: message.embeds.map((e) => e.toJSON()),
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

        if (restoreEmbeds.length > 0) {
          const sentMessages = await channel.send({ embeds: restoreEmbeds });
          restoredMessageIds.add(
            Array.isArray(sentMessages) ? sentMessages[0]?.id ?? "" : sentMessages.id,
          );
        } else if (cached.attachmentUrls.length > 0) {
          const sent = await channel.send(cached.attachmentUrls.join("\n"));
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
          ? `<@${cached.authorId}> tarafından gönderilen mesaj silindi ve **otomatik geri yüklendi**.`
          : "Önbelleğe alınmamış bir mesaj silindi (geri yüklenemedi).",
        color: Colors.DarkRed,
        fields: [
          { name: "Kanal", value: `<#${message.channelId}>`, inline: true },
          { name: "Sunucu", value: guild.name, inline: true },
          ...(cached
            ? [{ name: "Gönderen", value: `${cached.authorTag} (<@${cached.authorId}>)`, inline: false }]
            : []),
        ],
      });

      await sendLog(guild, alertEmbed);
      await dmAdmins(client, guild.id, alertEmbed);
    } catch (err) {
      console.error("messageDelete restore error:", err);
    }
  });
}
