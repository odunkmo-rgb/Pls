import {
  Client,
  TextChannel,
  EmbedBuilder,
  Colors,
  type Guild,
} from "discord.js";
import { CONFIG } from "../config.js";

export async function getLogChannel(
  guild: Guild,
): Promise<TextChannel | null> {
  try {
    const channel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID);
    if (channel && channel.isTextBased() && channel instanceof TextChannel) {
      return channel;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function sendLog(
  guild: Guild,
  embed: EmbedBuilder,
): Promise<void> {
  const channel = await getLogChannel(guild);
  if (!channel) return;
  await channel.send({ embeds: [embed] });
}

export async function getPublicLogChannel(
  guild: Guild,
): Promise<TextChannel | null> {
  try {
    const channel = await guild.channels.fetch(CONFIG.PUBLIC_LOG_CHANNEL_ID);
    if (channel && channel.isTextBased() && channel instanceof TextChannel) {
      return channel;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function sendPublicLog(
  guild: Guild,
  embed: EmbedBuilder,
): Promise<void> {
  const channel = await getPublicLogChannel(guild);
  if (!channel) return;
  await channel.send({ embeds: [embed] });
}

export function buildEmbed(options: {
  title: string;
  description: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setColor(options.color ?? Colors.Orange)
    .setTimestamp();

  if (options.fields) {
    embed.addFields(options.fields);
  }

  return embed;
}
