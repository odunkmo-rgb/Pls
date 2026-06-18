import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { registerGuildBanAdd } from "./handlers/guildBanAdd.js";
import { registerGuildMemberRemove } from "./handlers/guildMemberRemove.js";
import { registerChannelDelete } from "./handlers/channelDelete.js";
import { registerChannelCreate } from "./handlers/channelCreate.js";
import { registerMessageDelete } from "./handlers/messageDelete.js";
import { registerQuarantine } from "./handlers/quarantine.js";
import { registerSlashCommands } from "./handlers/slashCommands.js";
import { scheduleNightlyBackup } from "./handlers/backup.js";

export function startBot(): void {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    console.error("DISCORD_TOKEN bulunamadı, bot başlatılmıyor.");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.GuildMember,
    ],
  });

  registerGuildBanAdd(client);
  registerGuildMemberRemove(client);
  registerChannelDelete(client);
  registerChannelCreate(client);
  registerMessageDelete(client);
  registerQuarantine(client);
  registerSlashCommands(client);
  scheduleNightlyBackup(client);

  client.once("clientReady", (readyClient) => {
    console.log(`✅ Bot hazır: ${readyClient.user.tag}`);
    readyClient.user.setActivity("Kahvehaneyi Kolluyor", {
      type: ActivityType.Watching,
    });
  });

  client.on("error", (err) => {
    console.error("Discord client error:", err);
  });

  client.login(token);
}
