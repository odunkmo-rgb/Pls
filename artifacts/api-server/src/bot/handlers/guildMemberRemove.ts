import {
  type Client,
  Events,
  AuditLogEvent,
  Colors,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import {
  isExemptExecutor,
  isExemptRoleOnly,
  recordAction,
  cacheMemberRoles,
  isNonSpecialYetkili,
  isTargetProtected,
} from "../utils/actionTracker.js";
import { buildEmbed, sendLog } from "../utils/logger.js";
import { getYetkiliRolId } from "../utils/db.js";

export function registerGuildMemberRemove(client: Client): void {
  client.on(Events.GuildMemberRemove, async (member) => {
    const guild = member.guild;

    // Ayrılan üyenin rollerini cache'le (GuildBanAdd için de kullanılır)
    if ("roles" in member && member.roles) {
      cacheMemberRoles(member.id, member.roles.cache.map((r) => r.id));
    }

    await new Promise((r) => setTimeout(r, 1000));

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberKick,
        limit: 1,
      });

      const entry = auditLogs.entries.first();
      if (!entry || !entry.executor) return;

      const timeDiff = Date.now() - entry.createdTimestamp;
      if (timeDiff > 5000) return;
      if (entry.target?.id !== member.id) return;

      const executor = entry.executor;
      if (executor.id === client.user?.id) return;

      let execMember: GuildMember | null = null;
      try {
        execMember = await guild.members.fetch(executor.id);
      } catch {
        return;
      }

      const executorRoleIds = execMember.roles.cache.map((r) => r.id);
      const yetkiliRolId = await getYetkiliRolId(guild.id);

      // ── YETKİLİ KORUMA KONTROLÜ ──────────────────────────────────────────
      if (isNonSpecialYetkili(executor.id, executorRoleIds, yetkiliRolId)) {
        const targetRoleIds = "roles" in member && member.roles
          ? member.roles.cache.map((r) => r.id)
          : [];
        if (isTargetProtected(member.id, targetRoleIds, yetkiliRolId)) {
          await sendLog(
            guild,
            buildEmbed({
              title: "🛡️ KORUMA — Yetkili Kick'i Engellendi",
              description: `<@${executor.id}> kendi roldaşına veya üst yöneticiye kick uygulamaya çalıştı.`,
              color: Colors.Orange,
              fields: [
                { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
                { name: "Hedef", value: `<@${member.id}> (${member.user?.tag ?? member.id})`, inline: true },
                { name: "Durum", value: "⛔ Engellendi — Kayıt altına alındı", inline: false },
              ],
            }),
          );

          try {
            await execMember.send(
              "⛔ **Engellendi:** Kendi roldaşlarınıza veya üst yöneticilere moderasyon işlemi uygulayamazsınız!",
            );
          } catch { /* DM kapalı */ }
          return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const exempt = isExemptExecutor(executor.id, executorRoleIds);

      if (exempt) {
        await sendLog(
          guild,
          buildEmbed({
            title: "👢 Kick İşlemi",
            description: `**${member.user?.tag ?? member.id}** sunucudan atıldı.`,
            color: Colors.Orange,
            fields: [
              { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
              { name: "Durum", value: "Muaf — yaptırım uygulanmadı", inline: false },
            ],
          }),
        );
        if (isExemptRoleOnly(executor.id, executorRoleIds)) {
          try {
            await execMember.send(
              `📋 **Bilgi:** **${member.user?.tag ?? member.id}** kullanıcısını attın. Bu işlem kayıt altına alındı. Muaf olduğun için herhangi bir yaptırım uygulanmadı.`,
            );
          } catch { /* DM kapalı */ }
        }
        return;
      }

      const { exceeded, warning, count } = recordAction(executor.id, "kick", member.id);

      await sendLog(
        guild,
        buildEmbed({
          title: "👢 Kick İşlemi",
          description: `**${member.user?.tag ?? member.id}** sunucudan atıldı.`,
          color: Colors.Orange,
          fields: [
            { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
            { name: "İşlem Sayısı", value: `${count}/3`, inline: true },
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
        try { await execMember.send("⚠️ **Uyarı:** Sunucuda 2. işlemini yaptın. Bir daha yaparsan yönetici yetkilerin alınacak!"); } catch { /* ignore */ }
      }

      if (exceeded) {
        const adminRoles = execMember.roles.cache.filter(
          (r) =>
            r.permissions.has(PermissionFlagsBits.Administrator) ||
            r.permissions.has(PermissionFlagsBits.BanMembers) ||
            r.permissions.has(PermissionFlagsBits.KickMembers) ||
            r.permissions.has(PermissionFlagsBits.ManageChannels),
        );

        for (const [, role] of adminRoles) {
          try {
            await execMember.roles.remove(role, "Güvenlik: İşlem limiti aşıldı");
          } catch { /* ignore */ }
        }

        await sendLog(
          guild,
          buildEmbed({
            title: "🚨 YETKİ ALINDI — Limit Aşıldı",
            description: `<@${execMember.id}> 3. işlemini yaptı (kick). Yönetici rolleri alındı.`,
            color: Colors.DarkRed,
            fields: [
              {
                name: "Alınan Roller",
                value: adminRoles.size > 0 ? adminRoles.map((r) => r.name).join(", ") : "Yok",
              },
            ],
          }),
        );

        try { await execMember.send("🚨 **Yetkilerin alındı!** İşlem limitini aştığın için yönetici rolüerin kaldırıldı."); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error("guildMemberRemove handler error:", err);
    }
  });
}
