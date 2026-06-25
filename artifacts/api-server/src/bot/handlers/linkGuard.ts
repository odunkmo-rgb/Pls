import { type Client, Events, Colors } from "discord.js";
import { CONFIG } from "../config.js";
import { buildEmbed, sendLog } from "../utils/logger.js";
import { getLinkEngelAktif, setLinkEngelAktif } from "../utils/db.js";

// URL tespiti için regex
const LINK_REGEX = /https?:\/\/[^\s]+|discord\.gg\/[^\s]+|www\.[^\s]+/i;

export function registerLinkGuard(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Özel 3 kişi muaf
    if ((CONFIG.ALLOWED_USER_IDS as readonly string[]).includes(message.author.id)) return;

    // Link engel aktif mi?
    const aktif = await getLinkEngelAktif(message.guild.id);
    if (!aktif) return;

    // Mesajda link var mı?
    if (!LINK_REGEX.test(message.content)) return;

    // Mesajı sil
    try {
      await message.delete();
    } catch { return; }

    // Kullanıcıya uyarı DM gönder
    try {
      await message.author.send(
        `⛔ **${message.guild.name}** sunucusunda link paylaşımı engellidir. Mesajın silindi.`,
      );
    } catch { /* DM kapalı */ }

    // Log kanalına bildir
    await sendLog(
      message.guild,
      buildEmbed({
        title: "🔗 Link Engellendi",
        description: `<@${message.author.id}> link içeren mesaj gönderdi, otomatik silindi.`,
        color: Colors.Orange,
        fields: [
          { name: "Kullanıcı", value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
          { name: "Kanal", value: `<#${message.channelId}>`, inline: true },
          {
            name: "İçerik",
            value: message.content.slice(0, 200) || "(boş)",
            inline: false,
          },
        ],
      }),
    );
  });
}

export async function toggleLinkEngel(
  guildId: string,
  aktif: boolean,
): Promise<void> {
  await setLinkEngelAktif(guildId, aktif);
}
