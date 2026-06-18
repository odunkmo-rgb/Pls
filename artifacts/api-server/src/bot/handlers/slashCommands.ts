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

    const hasAccess = CONFIG.ALLOWED_USER_IDS.includes(interaction.user.id);

    if (!hasAccess) {
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
          await interaction.reply({
            content: "Henüz yedek alınmamış.",
            ephemeral: true,
          });
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
    }
  });
}
