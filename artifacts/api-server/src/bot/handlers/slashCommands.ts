import {
  type Client,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  Colors,
  PermissionFlagsBits,
} from "discord.js";
import { CONFIG } from "../config.js";
import { buildEmbed } from "../utils/logger.js";
import { takeBackup, restoreBackup, getBackup } from "./backup.js";
import { getYetkiliRolId, setYetkiliRolId } from "../utils/db.js";
import { resetUser, getRecord } from "../utils/actionTracker.js";

const commands = [
  new SlashCommandBuilder()
    .setName("yedek-al")
    .setDescription("Sunucunun yedeğini hemen al")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("Son yedekten eksik kanalları geri yükle")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("yedek-bilgi")
    .setDescription("Son yedek hakkında bilgi göster")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("sayac-sifirla")
    .setDescription("Bir kullanıcının işlem sayacını sıfırla")
    .addUserOption((opt) =>
      opt.setName("kullanici").setDescription("Sayacı sıfırlanacak kullanıcı").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("sayac-goruntule")
    .setDescription("Bir kullanıcının işlem sayacını görüntüle")
    .addUserOption((opt) =>
      opt.setName("kullanici").setDescription("Sayacı görüntülenecek kullanıcı").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ayarla-yetkilirol")
    .setDescription("Moderasyon yapabilecek yetkili rolünü ayarla (Sadece kurucu/sunucu sahibi)")
    .addRoleOption((opt) =>
      opt.setName("rol").setDescription("Yetkili rolü olarak atanacak rol").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("yardim")
    .setDescription("Tüm bot komutlarını listele")
    .toJSON(),
];

export async function registerSlashCommands(client: Client): Promise<void> {
  client.once(Events.ClientReady, async (readyClient) => {
    const rest = new REST().setToken(process.env["DISCORD_TOKEN"] ?? "");

    for (const [, guild] of readyClient.guilds.cache) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(readyClient.user.id, guild.id),
          { body: commands },
        );
        console.log(`Slash komutları ${guild.name} için kaydedildi.`);
      } catch (err) {
        console.error(`Slash komut kayıt hatası (${guild.name}):`, err);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild } = interaction;
    if (!guild) return;

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    const isSpecial = (CONFIG.ALLOWED_USER_IDS as readonly string[]).includes(interaction.user.id);
    const isOwner = guild.ownerId === interaction.user.id;

    // ── /AYARLA-YETKİLİROL ── sadece kurucu veya sunucu sahibi ──────────────
    if (commandName === "ayarla-yetkilirol") {
      if (!isSpecial && !isOwner) {
        await interaction.reply({
          embeds: [
            buildEmbed({
              title: "❌ Yetersiz Yetki",
              description: "Bu komutu sadece **kurucu kişiler** veya **sunucu sahibi** kullanabilir.",
              color: Colors.Red,
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      const rol = interaction.options.getRole("rol", true);
      await setYetkiliRolId(guild.id, rol.id);

      await interaction.reply({
        embeds: [
          buildEmbed({
            title: "✅ Yetkili Rolü Ayarlandı",
            description: `**${rol.name}** rolü yetkili rolü olarak kaydedildi.`,
            color: Colors.Green,
            fields: [
              { name: "Rol", value: `<@&${rol.id}>`, inline: true },
              { name: "Rol ID", value: rol.id, inline: true },
              {
                name: "Koruma Kuralı",
                value: "Bu role sahip kişiler birbirlerine moderasyon işlemi yapamaz.",
                inline: false,
              },
            ],
          }),
        ],
        ephemeral: true,
      });
      return;
    }

    // ── Diğer komutlar için özel erişim kontrolü ────────────────────────────
    if (!isSpecial) {
      await interaction.reply({
        embeds: [
          buildEmbed({
            title: "❌ Yetersiz Yetki",
            description: "Bu komutu kullanma yetkiniz yok.",
            color: Colors.Red,
          }),
        ],
        ephemeral: true,
      });
      return;
    }

    // ── KOMUT İŞLEYİCİLER ───────────────────────────────────────────────────
    switch (commandName) {
      case "yedek-al": {
        await interaction.deferReply({ ephemeral: true });
        const backup = await takeBackup(guild);
        const date = new Date(backup.takenAt).toLocaleString("tr-TR");
        await interaction.editReply({
          embeds: [
            buildEmbed({
              title: "💾 Yedek Alındı",
              description: "Sunucu yedeği başarıyla alındı.",
              color: Colors.Green,
              fields: [
                { name: "Tarih", value: date, inline: true },
                { name: "Kanal Sayısı", value: String(backup.channels.length), inline: true },
                { name: "Rol Sayısı", value: String(backup.roles.length), inline: true },
              ],
            }),
          ],
        });
        break;
      }

      case "restore": {
        await interaction.deferReply({ ephemeral: true });
        const result = await restoreBackup(guild);
        await interaction.editReply({
          embeds: [
            buildEmbed({
              title: "🔄 Yedek Geri Yüklendi",
              description: result,
              color: Colors.Blue,
            }),
          ],
        });
        break;
      }

      case "yedek-bilgi": {
        const backup = getBackup(guild.id);
        if (!backup) {
          await interaction.reply({ content: "Henüz yedek alınmamış.", ephemeral: true });
          return;
        }
        const date = new Date(backup.takenAt).toLocaleString("tr-TR");
        await interaction.reply({
          embeds: [
            buildEmbed({
              title: "📋 Yedek Bilgisi",
              description: `Son yedek: **${date}**`,
              color: Colors.Blurple,
              fields: [
                { name: "Kanal Sayısı", value: String(backup.channels.length), inline: true },
                { name: "Rol Sayısı", value: String(backup.roles.length), inline: true },
              ],
            }),
          ],
          ephemeral: true,
        });
        break;
      }

      case "sayac-sifirla": {
        const user = interaction.options.getUser("kullanici", true);
        resetUser(user.id);
        await interaction.reply({
          embeds: [
            buildEmbed({
              title: "🔄 Sayaç Sıfırlandı",
              description: `<@${user.id}> kullanıcısının işlem sayacı sıfırlandı.`,
              color: Colors.Green,
              fields: [{ name: "Kullanıcı", value: user.tag, inline: true }],
            }),
          ],
          ephemeral: true,
        });
        break;
      }

      case "sayac-goruntule": {
        const user = interaction.options.getUser("kullanici", true);
        const record = getRecord(user.id);
        const count = record?.count ?? 0;
        const actions = record?.actions
          .slice(-5)
          .map((a) => `• ${a.type} → <@${a.target}> (${new Date(a.at).toLocaleString("tr-TR")})`)
          .join("\n");

        await interaction.reply({
          embeds: [
            buildEmbed({
              title: "📊 İşlem Sayacı",
              description: `<@${user.id}> kullanıcısının mevcut sayacı: **${count}/3**`,
              color: count >= 3 ? Colors.Red : count >= 2 ? Colors.Yellow : Colors.Green,
              fields: actions
                ? [{ name: "Son 5 İşlem", value: actions, inline: false }]
                : [],
            }),
          ],
          ephemeral: true,
        });
        break;
      }

      case "yardim": {
        const yetkiliRolId = await getYetkiliRolId(guild.id);
        const yetkiliRolStr = yetkiliRolId
          ? `<@&${yetkiliRolId}>`
          : "Henüz ayarlanmadı (`/ayarla-yetkilirol`)";

        await interaction.reply({
          embeds: [
            buildEmbed({
              title: "📖 Bot Komutları",
              description: "Güvenlik Botu — Tüm Slash Komutları",
              color: Colors.Blurple,
              fields: [
                {
                  name: "⚙️ Ayarlar (Kurucu/Sunucu Sahibi)",
                  value: "`/ayarla-yetkilirol [rol]` — Koruma sistemindeki yetkili rolünü ayarlar",
                  inline: false,
                },
                {
                  name: "💾 Yedek",
                  value:
                    "`/yedek-al` — Anlık yedek\n`/restore` — Eksik kanalları geri yükle\n`/yedek-bilgi` — Son yedek bilgisi",
                  inline: false,
                },
                {
                  name: "📊 Sayaç",
                  value: "`/sayac-goruntule @kullanıcı`\n`/sayac-sifirla @kullanıcı`",
                  inline: false,
                },
                {
                  name: "🛡️ Mevcut Yetkili Rolü",
                  value: yetkiliRolStr,
                  inline: false,
                },
              ],
            }),
          ],
          ephemeral: true,
        });
        break;
      }
    }
  });
}
