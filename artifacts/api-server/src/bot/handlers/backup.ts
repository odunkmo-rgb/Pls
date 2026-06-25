import {
  type Client,
  Colors,
  ChannelType,
  type Guild,
} from "discord.js";
import cron from "node-cron";
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
    .filter((r) => r.id !== guild.id && !r.managed)
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

export async function restoreBackup(
  guild: Guild,
): Promise<{ summary: string; restoredChannels: string[]; restoredRoles: string[] }> {
  const backup = backupStore.get(guild.id);
  if (!backup) return { summary: "Yedek bulunamadı!", restoredChannels: [], restoredRoles: [] };

  await guild.channels.fetch();
  await guild.roles.fetch();

  const restoredChannels: string[] = [];
  const restoredRoles: string[] = [];
  const failedItems: string[] = [];

  // ── 1. ROL GERİ YÜKLE ────────────────────────────────────────────────────
  const existingRoleIds = new Set(guild.roles.cache.keys());

  // Rolleri pozisyona göre sırala (düşükten yükseğe)
  const missingRoles = backup.roles
    .filter((r) => !existingRoleIds.has(r.id))
    .sort((a, b) => a.position - b.position);

  for (const role of missingRoles) {
    try {
      await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: BigInt(role.permissions),
        reason: "Güvenlik Botu: Yedekten rol geri yükleme",
      });
      restoredRoles.push(role.name);
    } catch {
      failedItems.push(`Rol oluşturulamadı: ${role.name}`);
    }
  }

  // ── 2. KATEGORİLERİ ÖNCE OLUŞTUR ─────────────────────────────────────────
  const existingChannelIds = new Set(guild.channels.cache.keys());
  // Eski kategori ID → yeni oluşturulan kanal ID eşlemesi
  const categoryIdMap = new Map<string, string>();

  const missingCategories = backup.channels.filter(
    (ch) => ch.type === ChannelType.GuildCategory && !existingChannelIds.has(ch.id),
  );

  for (const cat of missingCategories) {
    try {
      const created = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        position: cat.position,
        reason: "Güvenlik Botu: Yedekten kategori geri yükleme",
      });
      categoryIdMap.set(cat.id, created.id);
      restoredChannels.push(`📁 ${cat.name}`);
    } catch {
      failedItems.push(`Kategori oluşturulamadı: ${cat.name}`);
    }
  }

  // Mevcut kategoriler de eşlemede olsun (silinmemiş olanlar)
  for (const [id, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildCategory) {
      if (!categoryIdMap.has(id)) categoryIdMap.set(id, id);
    }
  }

  // ── 3. DİĞER KANALLARI OLUŞTUR ───────────────────────────────────────────
  const missingChannels = backup.channels
    .filter(
      (ch) =>
        ch.type !== ChannelType.GuildCategory && !existingChannelIds.has(ch.id),
    )
    .sort((a, b) => a.position - b.position);

  for (const ch of missingChannels) {
    // Eski parent ID'yi yeni ID'ye çevir
    const newParentId = ch.parentId ? (categoryIdMap.get(ch.parentId) ?? ch.parentId) : undefined;

    try {
      if (ch.type === ChannelType.GuildText) {
        await guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildText,
          position: ch.position,
          topic: ch.topic ?? undefined,
          nsfw: ch.nsfw ?? false,
          parent: newParentId,
          reason: "Güvenlik Botu: Yedekten kanal geri yükleme",
        });
        restoredChannels.push(`💬 #${ch.name}`);
      } else if (ch.type === ChannelType.GuildVoice) {
        await guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildVoice,
          position: ch.position,
          parent: newParentId,
          reason: "Güvenlik Botu: Yedekten kanal geri yükleme",
        });
        restoredChannels.push(`🔊 ${ch.name}`);
      } else if (ch.type === ChannelType.GuildAnnouncement) {
        await guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildAnnouncement,
          position: ch.position,
          parent: newParentId,
          reason: "Güvenlik Botu: Yedekten kanal geri yükleme",
        });
        restoredChannels.push(`📢 ${ch.name}`);
      }
    } catch {
      failedItems.push(`Kanal oluşturulamadı: #${ch.name}`);
    }
  }

  const parts: string[] = [];
  if (restoredRoles.length > 0) parts.push(`✅ Geri yüklenen roller: ${restoredRoles.join(", ")}`);
  if (restoredChannels.length > 0) parts.push(`✅ Geri yüklenen kanallar: ${restoredChannels.join(", ")}`);
  if (failedItems.length > 0) parts.push(`⚠️ Başarısız: ${failedItems.join(", ")}`);

  const summary =
    parts.length > 0 ? parts.join("\n") : "✅ Eksik kanal veya rol bulunamadı, yedek güncel.";

  return { summary, restoredChannels, restoredRoles };
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
              { name: "Kanal Sayısı", value: String(backup.channels.length), inline: true },
              { name: "Rol Sayısı", value: String(backup.roles.length), inline: true },
            ],
          }),
        );
      } catch (err) {
        console.error("Nightly backup error:", err);
      }
    }
  });
}
