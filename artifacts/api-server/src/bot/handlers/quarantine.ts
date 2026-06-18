import { type Client, Events, Colors } from "discord.js";
import { CONFIG } from "../config.js";
import { buildEmbed, sendLog, sendPublicLog } from "../utils/logger.js";
import { query } from "../utils/db.js";

interface QuarantineRow {
  user_id: string;
  added_by: string;
  added_at: Date;
  reason: string | null;
}

const memoryCache = new Set<string>();

export async function loadQuarantineFromDb(): Promise<void> {
  try {
    const rows = await query<QuarantineRow>(
      "SELECT user_id FROM quarantine_users",
    );
    memoryCache.clear();
    for (const row of rows) {
      memoryCache.add(row.user_id);
    }
    console.log(`Karantina listesi yüklendi: ${memoryCache.size} kullanıcı.`);
  } catch (err) {
    console.error("Karantina listesi yüklenemedi:", err);
  }
}

export async function addQuarantineUser(
  userId: string,
  addedBy: string,
  reason?: string,
): Promise<void> {
  await query(
    `INSERT INTO quarantine_users (user_id, added_by, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, addedBy, reason ?? null],
  );
  memoryCache.add(userId);
}

export async function removeQuarantineUser(userId: string): Promise<void> {
  await query("DELETE FROM quarantine_users WHERE user_id = $1", [userId]);
  memoryCache.delete(userId);
}

export async function getQuarantineUsers(): Promise<QuarantineRow[]> {
  return query<QuarantineRow>(
    "SELECT user_id, added_by, added_at, reason FROM quarantine_users ORDER BY added_at DESC",
  );
}

export function isInQuarantine(userId: string): boolean {
  return memoryCache.has(userId);
}

export async function applyQuarantineToMember(
  guild: import("discord.js").Guild,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const quarantineRole = await guild.roles.fetch(CONFIG.QUARANTINE_ROLE_ID);
    if (!quarantineRole) return { success: false, message: "Karantina rolü bulunamadı." };

    let member: import("discord.js").GuildMember | null = null;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return { success: false, message: "Kullanıcı sunucuda bulunamadı." };
    }

    const previousRoles = member.roles.cache
      .filter((r) => r.id !== guild.id)
      .map((r) => r.name)
      .join(", ");

    for (const [roleId] of member.roles.cache.filter((r) => r.id !== guild.id)) {
      try {
        await member.roles.remove(roleId, "Karantina: Manuel uygulama");
      } catch { /* ignore */ }
    }

    await member.roles.add(quarantineRole, "Karantina: Manuel uygulama");

    const rows = await query<QuarantineRow>(
      "SELECT added_by, reason FROM quarantine_users WHERE user_id = $1",
      [userId],
    );
    const info = rows[0];

    await sendLog(
      guild,
      buildEmbed({
        title: "🔒 KARANTİNA — Manuel Uygulama",
        description: `<@${userId}> anında karantinaya alındı.`,
        color: Colors.Purple,
        fields: [
          { name: "Kullanıcı", value: `${member.user.tag}`, inline: true },
          { name: "ID", value: userId, inline: true },
          { name: "Sebep", value: info?.reason ?? "Belirtilmedi", inline: false },
          { name: "Alınan Roller", value: previousRoles || "Yok", inline: false },
          { name: "Verilen Rol", value: quarantineRole.name, inline: true },
        ],
      }),
    );

    return { success: true, message: `<@${userId}> karantinaya alındı.` };
  } catch (err) {
    console.error("applyQuarantineToMember error:", err);
    return { success: false, message: "Bir hata oluştu." };
  }
}

export function registerQuarantine(client: Client): void {
  client.once("clientReady", async () => {
    await loadQuarantineFromDb();
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!isInQuarantine(member.id)) return;

    const guild = member.guild;

    try {
      const quarantineRole = await guild.roles.fetch(CONFIG.QUARANTINE_ROLE_ID);
      if (!quarantineRole) return;

      const previousRoles = member.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => r.name)
        .join(", ");

      const roleIds = member.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => r.id);

      for (const roleId of roleIds) {
        try {
          await member.roles.remove(roleId, "Karantina: İzleme listesindeki kullanıcı");
        } catch {
          // ignore
        }
      }

      await member.roles.add(
        quarantineRole,
        "Karantina: İzleme listesindeki kullanıcı sunucuya katıldı",
      );

      const rows = await query<QuarantineRow>(
        "SELECT added_by, reason, added_at FROM quarantine_users WHERE user_id = $1",
        [member.id],
      );
      const info = rows[0];

      await sendLog(
        guild,
        buildEmbed({
          title: "🔒 KARANTİNA — İzleme Listesi Kullanıcısı",
          description: `<@${member.id}> sunucuya katıldı ve karantinaya alındı.`,
          color: Colors.Purple,
          fields: [
            { name: "Kullanıcı", value: `${member.user.tag}`, inline: true },
            { name: "ID", value: member.id, inline: true },
            {
              name: "Ekleyen",
              value: info ? `<@${info.added_by}>` : "Bilinmiyor",
              inline: true,
            },
            {
              name: "Sebep",
              value: info?.reason ?? "Belirtilmedi",
              inline: false,
            },
            {
              name: "Alınan Roller",
              value: previousRoles || "Yok",
              inline: false,
            },
            {
              name: "Verilen Rol",
              value: quarantineRole.name,
              inline: true,
            },
          ],
        }),
      );

      await sendPublicLog(
        guild,
        buildEmbed({
          title: "🔒 Kullanıcı Karantinaya Alındı",
          description: `<@${member.id}> sunucuya katıldığında karantinaya alındı.`,
          color: Colors.Purple,
          fields: [{ name: "Sebep", value: info?.reason ?? "Belirtilmedi" }],
        }),
      );
    } catch (err) {
      console.error("quarantine handler error:", err);
    }
  });
}
