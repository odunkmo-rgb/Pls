import {
  type Client,
  Events,
  AuditLogEvent,
  Colors,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import { isExemptUser, recordAction } from "../utils/actionTracker.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

export function registerGuildBanAdd(client: Client): void {
  client.on(Events.GuildBanAdd, async (ban) => {
    const guild = ban.guild;

    await new Promise((r) => setTimeout(r, 1000));

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberBanAdd,
        limit: 1,
      });

      const entry = auditLogs.entries.first();
      if (!entry || !entry.executor) return;

      const executor = entry.executor;
      if (executor.id === client.user?.id) return;

      let member: GuildMember | null = null;
      try {
        member = await guild.members.fetch(executor.id);
      } catch {
        return;
      }

      const exempt = isExemptUser(executor.id);

      if (exempt) {
        await sendLog(
          guild,
          buildEmbed({
            title: "🔨 Ban İşlemi",
            description: `**${ban.user.tag}** sunucudan banlandı.`,
            color: Colors.Red,
            fields: [
              { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
              { name: "Hedef", value: `<@${ban.user.id}>`, inline: true },
            ],
          }),
        );
        return;
      }

      const { exceeded, warning, count } = recordAction(executor.id, "ban", ban.user.id);

      await sendLog(
        guild,
        buildEmbed({
          title: "🔨 Ban İşlemi",
          description: `**${ban.user.tag}** sunucudan banlandı.`,
          color: Colors.Red,
          fields: [
            { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
            { name: "İşlem Sayısı", value: `${count}/3`, inline: true },
            { name: "Hedef", value: `<@${ban.user.id}>`, inline: true },
          ],
        }),
      );

      if (warning) {
        await sendLog(
          guild,
          buildEmbed({
            title: "⚠️ UYARI — Son Hak",
            description: `<@${executor.id}> **2. işlemini** yaptı. Bir işlem daha yaparsa yetkileri alınacak!`,
            color: Colors.Yellow,
            fields: [{ name: "Uyarı", value: "Tek hakkın var!" }],
          }),
        );
        try { await member.send("⚠️ **Uyarı:** Sunucuda 2. işlemini yaptın. Bir daha yaparsan yönetici yetkilerin alınacak!"); } catch { /* ignore */ }
      }

      if (exceeded) {
        await revokePermissions(guild, member, "ban");
      }
    } catch (err) {
      console.error("guildBanAdd handler error:", err);
    }
  });
}

async function revokePermissions(
  guild: import("discord.js").Guild,
  member: GuildMember,
  triggerType: string,
): Promise<void> {
  const adminRoles = member.roles.cache.filter((r) =>
    r.permissions.has(PermissionFlagsBits.Administrator) ||
    r.permissions.has(PermissionFlagsBits.BanMembers) ||
    r.permissions.has(PermissionFlagsBits.KickMembers) ||
    r.permissions.has(PermissionFlagsBits.ManageChannels),
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
      description: `<@${member.id}> 3. işlemini yaptı (${triggerType}). Yönetici rolleri alındı.`,
      color: Colors.DarkRed,
      fields: [
        {
          name: "Alınan Roller",
          value: adminRoles.size > 0 ? adminRoles.map((r) => r.name).join(", ") : "Yok",
        },
      ],
    }),
  );

  try { await member.send("🚨 **Yetkilerin alındı!** İşlem limitini aştığın için yönetici rolüerin kaldırıldı."); } catch { /* ignore */ }
}
