import {
  type Client,
  Events,
  AuditLogEvent,
  Colors,
  ChannelType,
} from "discord.js";
import { buildEmbed, sendLog } from "../utils/logger.js";

export function registerServerEvents(client: Client): void {

  // ── Kanal izinleri değişimi ──────────────────────────────────────────
  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!("guild" in newChannel) || !newChannel.guild) return;
    const guild = newChannel.guild;

    const oldPerms = "permissionOverwrites" in oldChannel
      ? oldChannel.permissionOverwrites.cache
      : null;
    const newPerms = "permissionOverwrites" in newChannel
      ? newChannel.permissionOverwrites.cache
      : null;

    const nameChanged =
      "name" in oldChannel && "name" in newChannel &&
      oldChannel.name !== newChannel.name;

    const topicChanged =
      "topic" in oldChannel && "topic" in newChannel &&
      (oldChannel as { topic?: string | null }).topic !==
      (newChannel as { topic?: string | null }).topic;

    const permsChanged =
      oldPerms && newPerms &&
      JSON.stringify([...oldPerms.values()].map((p) => ({ id: p.id, allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString() }))) !==
      JSON.stringify([...newPerms.values()].map((p) => ({ id: p.id, allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString() })));

    if (!nameChanged && !topicChanged && !permsChanged) return;

    await new Promise((r) => setTimeout(r, 500));

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelUpdate,
        limit: 3,
      });

      const entry = auditLogs.entries.find(
        (e) => e.target?.id === newChannel.id && Date.now() - e.createdTimestamp < 10000,
      );

      const executor = entry?.executor;
      const chanName = "name" in newChannel ? newChannel.name : newChannel.id;

      const fields = [
        { name: "Kanal", value: `<#${newChannel.id}>`, inline: true },
        ...(executor ? [{ name: "Yürüten", value: `<@${executor.id}>`, inline: true }] : []),
        ...(nameChanged ? [{ name: "İsim", value: `${"name" in oldChannel ? oldChannel.name : "?"} → ${chanName}`, inline: false }] : []),
        ...(topicChanged ? [{ name: "Konu", value: `${"topic" in oldChannel ? ((oldChannel as { topic?: string | null }).topic ?? "Yok") : "Yok"} → ${"topic" in newChannel ? ((newChannel as { topic?: string | null }).topic ?? "Yok") : "Yok"}`, inline: false }] : []),
        ...(permsChanged ? [{ name: "İzinler", value: "İzin ayarları değiştirildi", inline: false }] : []),
      ];

      await sendLog(
        guild,
        buildEmbed({
          title: "⚙️ Kanal Güncellendi",
          description: `**#${chanName}** kanalında değişiklik yapıldı.`,
          color: Colors.Orange,
          fields,
        }),
      );
    } catch (err) {
      console.error("channelUpdate handler error:", err);
    }
  });

  // ── Kullanıcı adı / global isim değişimi ─────────────────────────────
  client.on(Events.UserUpdate, async (oldUser, newUser) => {
    const usernameChanged = oldUser.username !== newUser.username;
    const displayNameChanged = oldUser.displayName !== newUser.displayName;
    const avatarChanged = oldUser.avatar !== newUser.avatar;

    if (!usernameChanged && !displayNameChanged && !avatarChanged) return;

    for (const [, guild] of client.guilds.cache) {
      const member = guild.members.cache.get(newUser.id);
      if (!member) continue;

      const fields = [
        { name: "Kullanıcı", value: `<@${newUser.id}>`, inline: true },
        ...(usernameChanged ? [{ name: "Kullanıcı Adı", value: `${oldUser.username} → ${newUser.username}`, inline: false }] : []),
        ...(displayNameChanged ? [{ name: "Görünen Ad", value: `${oldUser.displayName} → ${newUser.displayName}`, inline: false }] : []),
        ...(avatarChanged ? [{ name: "Avatar", value: "Profil fotoğrafı değiştirildi", inline: false }] : []),
      ];

      await sendLog(
        guild,
        buildEmbed({
          title: "👤 Kullanıcı Profili Değişti",
          description: `<@${newUser.id}> profilini güncelledi.`,
          color: Colors.Blurple,
          fields,
        }),
      ).catch(() => null);
    }
  });

  // ── Sunucu nickname değişimi ──────────────────────────────────────────
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const oldNick = oldMember.nickname;
    const newNick = newMember.nickname;
    if (oldNick === newNick) return;

    const guild = newMember.guild;
    await new Promise((r) => setTimeout(r, 500));

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberUpdate,
        limit: 3,
      });

      const entry = auditLogs.entries.find(
        (e) =>
          e.target?.id === newMember.id &&
          Date.now() - e.createdTimestamp < 10000,
      );

      const executor = entry?.executor;
      const selfChange = executor?.id === newMember.id;

      await sendLog(
        guild,
        buildEmbed({
          title: "✏️ Nickname Değişti",
          description: `<@${newMember.id}> için sunucu adı güncellendi.`,
          color: Colors.LightGrey,
          fields: [
            { name: "Eski Ad", value: oldNick ?? "(yok)", inline: true },
            { name: "Yeni Ad", value: newNick ?? "(yok)", inline: true },
            ...(executor && !selfChange
              ? [{ name: "Değiştiren", value: `<@${executor.id}>`, inline: false }]
              : []),
          ],
        }),
      );
    } catch (err) {
      console.error("nicknameUpdate handler error:", err);
    }
  });

  // ── Rol oluşturma / silme / güncelleme ───────────────────────────────
  client.on(Events.GuildRoleCreate, async (role) => {
    const guild = role.guild;
    await new Promise((r) => setTimeout(r, 500));
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 3 });
      const entry = auditLogs.entries.find(
        (e) => e.target?.id === role.id && Date.now() - e.createdTimestamp < 10000,
      );
      await sendLog(guild, buildEmbed({
        title: "🟢 Rol Oluşturuldu",
        description: `**${role.name}** rolü oluşturuldu.`,
        color: Colors.Green,
        fields: [
          { name: "Rol", value: `<@&${role.id}>`, inline: true },
          ...(entry?.executor ? [{ name: "Yürüten", value: `<@${entry.executor.id}>`, inline: true }] : []),
        ],
      }));
    } catch (err) { console.error("roleCreate handler error:", err); }
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    const guild = role.guild;
    await new Promise((r) => setTimeout(r, 500));
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 3 });
      const entry = auditLogs.entries.find(
        (e) => e.target?.id === role.id && Date.now() - e.createdTimestamp < 10000,
      );
      await sendLog(guild, buildEmbed({
        title: "🔴 Rol Silindi",
        description: `**${role.name}** rolü silindi.`,
        color: Colors.Red,
        fields: [
          ...(entry?.executor ? [{ name: "Yürüten", value: `<@${entry.executor.id}>`, inline: true }] : []),
        ],
      }));
    } catch (err) { console.error("roleDelete handler error:", err); }
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const guild = newRole.guild;
    const nameChanged = oldRole.name !== newRole.name;
    const colorChanged = oldRole.color !== newRole.color;
    const permChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
    if (!nameChanged && !colorChanged && !permChanged) return;

    await new Promise((r) => setTimeout(r, 500));
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 3 });
      const entry = auditLogs.entries.find(
        (e) => e.target?.id === newRole.id && Date.now() - e.createdTimestamp < 10000,
      );
      await sendLog(guild, buildEmbed({
        title: "🔧 Rol Güncellendi",
        description: `**${newRole.name}** rolünde değişiklik.`,
        color: Colors.Yellow,
        fields: [
          { name: "Rol", value: `<@&${newRole.id}>`, inline: true },
          ...(entry?.executor ? [{ name: "Yürüten", value: `<@${entry.executor.id}>`, inline: true }] : []),
          ...(nameChanged ? [{ name: "İsim", value: `${oldRole.name} → ${newRole.name}`, inline: false }] : []),
          ...(colorChanged ? [{ name: "Renk", value: `#${oldRole.color.toString(16)} → #${newRole.color.toString(16)}`, inline: false }] : []),
          ...(permChanged ? [{ name: "İzinler", value: "Rol izinleri değiştirildi", inline: false }] : []),
        ],
      }));
    } catch (err) { console.error("roleUpdate event handler error:", err); }
  });

  // ── Sunucu ayarları değişimi ──────────────────────────────────────────
  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const nameChanged = oldGuild.name !== newGuild.name;
    const iconChanged = oldGuild.icon !== newGuild.icon;
    if (!nameChanged && !iconChanged) return;

    await new Promise((r) => setTimeout(r, 500));
    try {
      const auditLogs = await newGuild.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 3 });
      const entry = auditLogs.entries.find(
        (e) => Date.now() - e.createdTimestamp < 10000,
      );
      await sendLog(newGuild, buildEmbed({
        title: "🏠 Sunucu Güncellendi",
        description: "Sunucu ayarları değiştirildi.",
        color: Colors.Purple,
        fields: [
          ...(entry?.executor ? [{ name: "Yürüten", value: `<@${entry.executor.id}>`, inline: true }] : []),
          ...(nameChanged ? [{ name: "İsim", value: `${oldGuild.name} → ${newGuild.name}`, inline: false }] : []),
          ...(iconChanged ? [{ name: "İkon", value: "Sunucu ikonu değiştirildi", inline: false }] : []),
        ],
      }));
    } catch (err) { console.error("guildUpdate handler error:", err); }
  });

}
