import {
  type Client,
  Events,
  Colors,
  ChannelType,
  PermissionsBitField,
  type TextChannel,
  type CategoryChannel,
  type VoiceChannel,
  type Guild,
  type GuildMember,
  EmbedBuilder,
} from "discord.js";
import cron from "node-cron";
import { CONFIG } from "../config.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

interface ChannelBackup {
  id: string;
  name: string;
  type: number;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  parentId?: string | null;
  permissionOverwrites: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
}

interface RoleBackup {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
}

interface GuildBackup {
  guildId: string;
  guildName: string;
  takenAt: number;
  channels: ChannelBackup[];
  roles: RoleBackup[];
}

const backupStore = new Map<string, GuildBackup>();

export async function takeBackup(guild: Guild): Promise<GuildBackup> {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const channels: ChannelBackup[] = guild.channels.cache.map((ch) => ({
    id: ch.id,
    name: ch.name,
    type: ch.type,
    position: "position" in ch ? (ch.position as number) : 0,
    topic: "topic" in ch ? (ch.topic as string | null) : null,
    nsfw: "nsfw" in ch ? (ch.nsfw as boolean) : false,
    parentId: "parentId" in ch ? (ch.parentId as string | null) : null,
    permissionOverwrites:
      "permissionOverwrites" in ch
        ? (ch as import("discord.js").TextChannel).permissionOverwrites.cache.map((ow) => ({
            id: ow.id,
            type: ow.type,
            allow: ow.allow.bitfield.toString(),
            deny: ow.deny.bitfield.toString(),
          }))
        : [],
  }));

  const roles: RoleBackup[] = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
    }));

  const backup: GuildBackup = {
    guildId: guild.id,
    guildName: guild.name,
    takenAt: Date.now(),
    channels,
    roles,
  };

  backupStore.set(guild.id, backup);
  return backup;
}

export function getBackup(guildId: string): GuildBackup | undefined {
  return backupStore.get(guildId);
}

export async function restoreBackup(guild: Guild): Promise<string> {
  const backup = backupStore.get(guild.id);
  if (!backup) return "Yedek bulunamadı!";

  const log: string[] = [];

  const existingChannelIds = new Set(guild.channels.cache.keys());
  const backedUpIds = new Set(backup.channels.map((c) => c.id));

  for (const ch of backup.channels) {
    if (!existingChannelIds.has(ch.id)) {
      try {
        if (ch.type === ChannelType.GuildCategory) {
          await guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildCategory,
            position: ch.position,
          });
          log.push(`Kategori oluşturuldu: #${ch.name}`);
        } else if (ch.type === ChannelType.GuildText) {
          await guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildText,
            position: ch.position,
            topic: ch.topic ?? undefined,
            nsfw: ch.nsfw ?? false,
          });
          log.push(`Kanal oluşturuldu: #${ch.name}`);
        } else if (ch.type === ChannelType.GuildVoice) {
          await guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildVoice,
            position: ch.position,
          });
          log.push(`Ses kanalı oluşturuldu: ${ch.name}`);
        }
      } catch (err) {
        log.push(`Kanal oluşturulamadı: #${ch.name}`);
      }
    }
  }

  return log.length > 0 ? log.join("\n") : "Eksik kanal bulunamadı, yedek güncel.";
}

export function scheduleNightlyBackup(client: Client): void {
  cron.schedule("0 21 * * *", async () => {
    for (const [, guild] of client.guilds.cache) {
      try {
        const backup = await takeBackup(guild);
        const date = new Date(backup.takenAt).toLocaleDateString("tr-TR");

        await sendLog(
          guild,
          buildEmbed({
            title: "💾 Gece Yedeği Alındı",
            description: `Sunucu yedeği başarıyla alındı. Geri yüklemek için \`/restore\` komutunu kullanın.`,
            color: Colors.Green,
            fields: [
              { name: "Tarih", value: date, inline: true },
              {
                name: "Kanal Sayısı",
                value: String(backup.channels.length),
                inline: true,
              },
              {
                name: "Rol Sayısı",
                value: String(backup.roles.length),
                inline: true,
              },
            ],
          }),
        );
      } catch (err) {
        console.error("Nightly backup error:", err);
      }
    }
  });
}
