import {
  type Client,
  Events,
  AuditLogEvent,
  Colors,
} from "discord.js";
import { isExemptExecutor } from "../utils/actionTracker.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

export function registerRoleUpdate(client: Client): void {
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const guild = newMember.guild;

    const oldRoleIds = new Set(oldMember.roles.cache.keys());
    const newRoleIds = new Set(newMember.roles.cache.keys());

    const addedRoles = [...newRoleIds].filter((id) => !oldRoleIds.has(id));
    const removedRoles = [...oldRoleIds].filter((id) => !newRoleIds.has(id));

    if (addedRoles.length === 0 && removedRoles.length === 0) return;

    // Daha kısa bekleme + daha geniş zaman penceresi
    await new Promise((r) => setTimeout(r, 500));

    const tryFetch = async (attempt: number) => {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberRoleUpdate,
        limit: 5,
      });

      const entry = auditLogs.entries.find((e) => {
        if (!e.executor || !e.target) return false;
        if (e.target.id !== newMember.id) return false;
        return Date.now() - e.createdTimestamp < 15000;
      });

      if (!entry && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500));
        return tryFetch(attempt + 1);
      }

      return entry ?? null;
    };

    try {
      const entry = await tryFetch(1);
      if (!entry || !entry.executor) return;

      const executor = entry.executor;
      if (executor.id === client.user?.id) return;

      let execMember = guild.members.cache.get(executor.id);
      if (!execMember) {
        try { execMember = await guild.members.fetch(executor.id); } catch { return; }
      }

      const execRoleIds = execMember.roles.cache.map((r) => r.id);
      const exempt = isExemptExecutor(executor.id, execRoleIds);

      const addedNames = addedRoles
        .map((id) => guild.roles.cache.get(id)?.name ?? id)
        .join(", ");
      const removedNames = removedRoles
        .map((id) => guild.roles.cache.get(id)?.name ?? id)
        .join(", ");

      const fields = [
        { name: "Yürüten", value: `<@${executor.id}>`, inline: true },
        { name: "Hedef", value: `<@${newMember.id}>`, inline: true },
        ...(addedNames ? [{ name: "➕ Verilen Roller", value: addedNames, inline: false }] : []),
        ...(removedNames ? [{ name: "➖ Alınan Roller", value: removedNames, inline: false }] : []),
        ...(exempt
          ? [{ name: "İzleme", value: "Muaf — sayılmadı", inline: true }]
          : [{ name: "İzleme", value: "Sayaca işlendi", inline: true }]),
      ];

      await sendLog(
        guild,
        buildEmbed({
          title: "🎭 Rol Değişikliği",
          description: `<@${newMember.id}> için rol güncellendi.`,
          color: exempt ? Colors.Grey : Colors.Blue,
          fields,
        }),
      );
    } catch (err) {
      console.error("roleUpdate handler error:", err);
    }
  });
}
