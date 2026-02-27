import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { storage } from "./storage";
import { log } from "./index";
import {
  getSteamPlayerSummaries,
  getExvlBenchmark,
  getPlayerAllBenchmarks,
  getKovaaksRecentPlaytime,
  countryCodeToFlag,
  personaStateToString,
  isPlayingTrackedGame,
  getTrackingRolesForPlayer,
  getAllTrackingRoleNames,
  TRACKING_ROLE_COLORS,
  RANK_COLORS,
  getViscoseRolesOrdered,
  getVoltaicRolesOrdered,
  getJPRolesOrdered,
  KOVAAKS_APP_ID,
  VISCOSE_EASY_RANKS,
  VISCOSE_MEDIUM_RANKS,
  VISCOSE_HARD_RANKS,
  VOLTAIC_NOV_RANKS,
  VOLTAIC_INT_RANKS,
  VOLTAIC_ADV_RANKS,
  JP_EASY_RANKS,
  JP_HARD_RANKS,
  ALL_BENCHMARK_RANKS,
  ALL_VOLTAIC_RANKS,
  ALL_VISCOSE_RANKS,
  ALL_JP_RANKS,
  JP_BENCHMARK_IDS,
  JP_ROLE_BENCHMARK_IDS,
  JP_BENCHMARK_PREFIX,
  BENCHMARK_RANK_MAP,
  TRACKED_BENCHMARKS,
  getKovaaksBenchmarkProgress,
  getAvgLeaderboardRank,
  type SteamPlayerSummary,
  type ExvlBenchmarkEntry,
} from "./apis";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const DISCORD_APP_ID = process.env.DISCORD_APP_ID!;

function formatBenchmarkShort(b: ExvlBenchmarkEntry, livePos?: number | null): string {
  const progress = b.progress <= 1 ? b.progress * 100 : b.progress;
  const pos = livePos ?? b.position;
  if (b.rankName !== "Unranked") {
    const energyStr = b.energy > 0 ? ` · ${b.energy.toFixed(1)} energy` : "";
    return `**${b.rankName}**${energyStr} · #${pos}`;
  }
  if (progress > 0) {
    return `${progress.toFixed(0)}% · #${pos}`;
  }
  return `Unranked · #${pos}`;
}

const DIFF_LABELS: Record<number, string> = {
  686: "Easy", 687: "Medium", 688: "Hard",
  459: "Novice", 458: "Intermediate", 460: "Advanced",
  988: "Fundamentals", 962: "Easy", 959: "Hard",
};

function formatProfileLine(b: ExvlBenchmarkEntry, livePos?: number | null): string {
  const progress = b.progress <= 1 ? b.progress * 100 : b.progress;
  const label = DIFF_LABELS[b.benchmarkId] || "";
  const pos = livePos ?? b.position;
  if (b.rankName !== "Unranked") {
    if (progress >= 100) {
      return `${label} — **${b.rankName}** · #${pos}`;
    }
    return `${label} — **${b.rankName}** · ${progress.toFixed(0)}% to next · #${pos}`;
  }
  if (progress > 0) return `${label} — ${progress.toFixed(0)}% to first rank · #${pos}`;
  return `${label} — Unranked · #${pos}`;
}

function buildProfileEmbed(
  player: { discordId: string; discordUsername: string; steamId: string },
  steam: SteamPlayerSummary | null,
  benchmarks: ExvlBenchmarkEntry[],
  livePositions?: Map<number, number | null>,
): EmbedBuilder {
  const exvlUrl = `https://evxl.app/u/${player.steamId}`;
  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle(player.discordUsername)
    .setURL(exvlUrl)
    .setTimestamp();

  if (steam?.avatarfull) embed.setThumbnail(steam.avatarfull);

  const descParts: string[] = [];
  if (steam) {
    const flag = countryCodeToFlag(steam.loccountrycode);
    const status = steam.gameextrainfo
      ? `Playing **${steam.gameextrainfo}**`
      : personaStateToString(steam.personastate);
    descParts.push(`${flag} ${status}`);
    descParts.push(`<@${player.discordId}> · [${steam.personaname}](${steam.profileurl})`);
  } else {
    descParts.push(`<@${player.discordId}> · \`${player.steamId}\``);
  }

  const viscose = benchmarks.filter(b => [686, 687, 688].includes(b.benchmarkId));
  const voltaic = benchmarks.filter(b => [459, 458, 460].includes(b.benchmarkId));
  const jp = benchmarks.filter(b => JP_BENCHMARK_IDS.has(b.benchmarkId));

  if (viscose.length > 0) {
    descParts.push("");
    descParts.push("**── Viscose ──**");
    for (const b of viscose) descParts.push(formatProfileLine(b, livePositions?.get(b.benchmarkId)));
  }
  if (voltaic.length > 0) {
    descParts.push("");
    descParts.push("**── Voltaic S5 ──**");
    for (const b of voltaic) descParts.push(formatProfileLine(b, livePositions?.get(b.benchmarkId)));
  }
  if (jp.length > 0) {
    descParts.push("");
    descParts.push("**── Jade Palace Ground ──**");
    for (const b of jp) descParts.push(formatProfileLine(b, livePositions?.get(b.benchmarkId)));
  }

  descParts.push("");
  descParts.push(`[Open Benchmarks](${exvlUrl})`);

  embed.setDescription(truncateDescription(descParts.join("\n")));
  return embed;
}

function truncateDescription(text: string, limit = 4096): string {
  if (text.length <= limit) return text;
  const suffix = "\n\n*(truncated)*";
  const lines = text.split("\n");
  let result = "";
  for (const line of lines) {
    if ((result + "\n" + line + suffix).length > limit) break;
    result += (result ? "\n" : "") + line;
  }
  return result + suffix;
}

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.on("error", (err) => {
  console.error("Discord client error:", err.message);
});

client.rest.on("rateLimited", (info) => {
  console.warn(`Discord REST rate limited: ${info.method} ${info.url} — retry after ${info.retryAfter}ms`);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("Unhandled rejection:", reason?.message ?? reason);
});

const pendingGuildMap = new Map<string, string>();
let syncInProgress = false;

const commands = [
  new SlashCommandBuilder()
    .setName("aimdb")
    .setDescription("Open the AimDB player tracker menu"),
  new SlashCommandBuilder()
    .setName("aimdb-admin")
    .setDescription("Manage tracked players (Council / Manage Server only)"),
];

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  try {
    log("Registering slash commands...", "discord");
    await rest.put(Routes.applicationCommands(DISCORD_APP_ID), {
      body: commands.map(c => c.toJSON()),
    });
    log("Slash commands registered successfully!", "discord");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

async function buildMainMenu() {
  const players = await storage.getPlayers();
  const playerCount = players.length;
  let onlineCount = 0;
  let playingCount = 0;
  if (players.length > 0) {
    const steamIds = players.map(p => p.steamId);
    const summaries = await getSteamPlayerSummaries(steamIds);
    onlineCount = summaries.filter(s => s.personastate > 0).length;
    playingCount = summaries.filter(s => s.gameid).length;
  }

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("menu_myprofile")
      .setLabel("My Profile")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("👤"),
    new ButtonBuilder()
      .setCustomId("menu_stats")
      .setLabel("Look Up")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔍"),
    new ButtonBuilder()
      .setCustomId("menu_leaderboard")
      .setLabel("Leaderboard")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🏆"),
    new ButtonBuilder()
      .setCustomId("menu_nowplaying")
      .setLabel("Now Playing")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎮"),
    new ButtonBuilder()
      .setCustomId("menu_activity")
      .setLabel("Activity")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📈"),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("menu_updateroles")
      .setLabel("Update My Roles")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🔄"),
  );

  const lines = [
    `📊 Tracking **${playerCount}** players`,
    `🟢 **${onlineCount}** online`,
    `🎮 **${playingCount}** in game`,
  ];

  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle("AimDB")
    .setDescription(lines.join("\n"));

  return { embeds: [embed], components: [row1, row2] };
}

function buildAdminMenu() {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("menu_addplayer")
      .setLabel("Add Player")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId("menu_updateplayer")
      .setLabel("Update Player")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✏️"),
    new ButtonBuilder()
      .setCustomId("menu_removeplayer")
      .setLabel("Remove Player")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️"),
  );

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle("AimDB — Admin")
    .setDescription("Add, update, or remove tracked players.");

  return { embeds: [embed], components: [row], ephemeral: true };
}

function checkAdminPerms(member: any): boolean {
  if (!member) return false;
  if ("permissions" in member && member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (typeof member.permissions === "string") {
    const bits = BigInt(member.permissions);
    if (bits & PermissionFlagsBits.ManageGuild) return true;
  }
  return false;
}

function hasCouncilRole(interaction: { member: any; guild?: any; guildId?: string | null }): boolean {
  const member = interaction.member;
  if (!member) return false;
  if (member.roles?.cache) {
    return member.roles.cache.some((r: any) => r.name.toLowerCase() === "council");
  }
  if (Array.isArray(member.roles)) {
    const guild = (interaction as any).guild || client.guilds.cache.get((interaction as any).guildId);
    if (guild?.roles?.cache) {
      return member.roles.some((roleId: string) => {
        const role = guild.roles.cache.get(roleId);
        return role && role.name.toLowerCase() === "council";
      });
    }
  }
  return false;
}

function checkIsAdmin(interaction: any): boolean {
  return checkAdminPerms(interaction.member) || hasCouncilRole(interaction);
}

import type { Guild, GuildMember } from "discord.js";

const TARGET_GUILD_ID = "1457464164300882058";

async function findGoatRole(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    const goatRole = roles.find(r => r.name.toLowerCase() === "goat");
    if (!goatRole) {
      log(`Could not find "goat" role in guild ${guild.name}`, "discord");
      return null;
    }
    return goatRole;
  } catch (e: any) {
    console.error("Failed to find goat role:", e?.message);
    return null;
  }
}

function memberIsRepresentingGuild(member: GuildMember): boolean {
  const user = member.user as any;
  const pg = user.primaryGuild;
  if (!pg) return false;
  return pg.identityGuildId === member.guild.id && pg.identityEnabled === true;
}

async function syncServerTagRole(guild: Guild) {
  const goatRole = await findGoatRole(guild);
  if (!goatRole) {
    log("Goat role not found — skipping sync", "discord");
    return;
  }
  log(`Syncing goat role "${goatRole.name}" for all members...`, "discord");

  try {
    let members;
    try {
      members = await guild.members.fetch();
    } catch (fetchErr: any) {
      console.error("Failed to fetch members for goat sync, using cache:", fetchErr?.message);
      members = guild.members.cache;
    }

    let added = 0;
    let removed = 0;
    const memberArray = Array.from(members.values());

    for (const member of memberArray) {
      if (member.user.bot) continue;
      const isRepresenting = memberIsRepresentingGuild(member);
      const hasRole = member.roles.cache.has(goatRole.id);

      try {
        if (isRepresenting && !hasRole) {
          await member.roles.add(goatRole, "AimDB: member is using server tag");
          added++;
        } else if (!isRepresenting && hasRole) {
          await member.roles.remove(goatRole, "AimDB: member stopped using server tag");
          removed++;
        }
      } catch (e: any) {
        console.error(`Failed to update goat role for ${member.user.username}:`, e?.message);
      }
    }

    log(`Goat role sync complete: ${added} added, ${removed} removed`, "discord");
  } catch (e: any) {
    console.error("Failed to sync goat roles:", e?.message);
  }
}

async function syncGuestRole(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    const linkedRole = roles.find(r => r.name.toLowerCase() === "linked");
    const guestRole = roles.find(r => r.name.toLowerCase() === "guest");

    if (!guestRole) {
      log(`Could not find "guest" role in guild ${guild.name}`, "discord");
      return;
    }

    log(`Syncing guest role for members without Linked role...`, "discord");
    const members = guild.members.cache.size > 0 ? guild.members.cache : await guild.members.fetch();

    let added = 0;
    let removed = 0;
    const missingGuest: string[] = [];
    const memberArray = Array.from(members.values());

    for (const member of memberArray) {
      if (member.user.bot) continue;
      const hasLinked = linkedRole ? member.roles.cache.has(linkedRole.id) : false;
      const hasGuest = member.roles.cache.has(guestRole.id);

      try {
        if (!hasLinked && !hasGuest) {
          await member.roles.add(guestRole, "AimDB: member not linked, assigning guest");
          added++;
          missingGuest.push(member.user.username);
        } else if (hasLinked && hasGuest) {
          await member.roles.remove(guestRole, "AimDB: member is linked, removing guest");
          removed++;
        }
      } catch (e: any) {
        console.error(`Failed to update guest role for ${member.user.username}:`, e?.message);
      }
    }

    if (missingGuest.length > 0) {
      log(`Added guest role to: ${missingGuest.join(", ")}`, "discord");
    }
    log(`Guest role sync complete: ${added} added, ${removed} removed`, "discord");
  } catch (e: any) {
    console.error("Failed to sync guest roles:", e?.message);
  }
}

interface DividerRoles {
  voltaicDivider: any | undefined;
  viscoseDivider: any | undefined;
  jpDivider: any | undefined;
  languageDivider: any | undefined;
}

function findDividerRoles(roles: ReturnType<typeof Map.prototype.values> & Iterable<any>): DividerRoles {
  const rolesArr = Array.from(roles);
  return {
    voltaicDivider: rolesArr.find((r: any) => r.name.toLowerCase().includes("voltaic") && !r.name.includes("Complete") && !r.name.includes("Tracking") && !r.name.toLowerCase().includes("unranked")),
    viscoseDivider: rolesArr.find((r: any) => r.name.toLowerCase().includes("viscose") && !r.name.includes("Complete") && !r.name.includes("Tracking") && !r.name.toLowerCase().includes("unranked")),
    jpDivider: rolesArr.find((r: any) => r.name.toLowerCase().includes("jade palace") && !r.name.includes("Complete") && !r.name.startsWith("JP ")),
    languageDivider: rolesArr.find((r: any) => r.name.toLowerCase().includes("language") && !r.name.toLowerCase().includes("french") && !r.name.toLowerCase().includes("german") && !r.name.toLowerCase().includes("russian") && !r.name.toLowerCase().includes("spanish") && !r.name.toLowerCase().includes("english") && !r.name.toLowerCase().includes("dutch") && !r.name.toLowerCase().includes("portuguese")),
  };
}

async function syncDividerAndUnrankedRoles(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    const members = guild.members.cache.size > 0 ? guild.members.cache : await guild.members.fetch();

    const dividers = findDividerRoles(roles.values());
    const { voltaicDivider, viscoseDivider, jpDivider, languageDivider } = dividers;
    const unrankedVoltaic = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("voltaic"));
    const unrankedViscose = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("viscose"));
    let unrankedJP = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("jp"));

    if (!unrankedJP) {
      try {
        unrankedJP = await guild.roles.create({
          name: "Unranked JP",
          color: 0x000000,
          reason: "AimDB: auto-created Unranked JP role",
        });
        log(`Created "Unranked JP" role`, "discord");
      } catch (e: any) {
        console.error("Failed to create Unranked JP role:", e?.message);
      }
    }

    const voltaicRankNames = new Set<string>();
    for (const rank of ALL_VOLTAIC_RANKS) {
      voltaicRankNames.add(`${rank} Complete`);
      voltaicRankNames.add(`${rank} Tracking`);
    }
    const viscoseRankNames = new Set<string>();
    for (const rank of ALL_VISCOSE_RANKS) {
      viscoseRankNames.add(`${rank} Complete`);
      viscoseRankNames.add(`${rank} Tracking`);
    }
    const jpRankNames = new Set<string>();
    for (const rank of JP_EASY_RANKS) {
      jpRankNames.add(`JP Easy ${rank} Complete`);
    }
    for (const rank of JP_HARD_RANKS) {
      jpRankNames.add(`JP Hard ${rank} Complete`);
    }

    const voltaicRoleIds = new Set<string>();
    const viscoseRoleIds = new Set<string>();
    const jpRoleIds = new Set<string>();
    for (const role of Array.from(roles.values())) {
      if (voltaicRankNames.has(role.name)) voltaicRoleIds.add(role.id);
      if (viscoseRankNames.has(role.name)) viscoseRoleIds.add(role.id);
      if (jpRankNames.has(role.name)) jpRoleIds.add(role.id);
    }

    let dividersAdded = 0;
    let unrankedAdded = 0;
    let unrankedRemoved = 0;
    const memberArray = Array.from(members.values());

    for (const member of memberArray) {
      if (member.user.bot) continue;
      try {
        if (voltaicDivider && !member.roles.cache.has(voltaicDivider.id)) {
          await member.roles.add(voltaicDivider, "AimDB: adding voltaic divider");
          dividersAdded++;
        }
        if (viscoseDivider && !member.roles.cache.has(viscoseDivider.id)) {
          await member.roles.add(viscoseDivider, "AimDB: adding viscose divider");
          dividersAdded++;
        }
        if (jpDivider && !member.roles.cache.has(jpDivider.id)) {
          await member.roles.add(jpDivider, "AimDB: adding jade palace divider");
          dividersAdded++;
        }
        if (languageDivider && !member.roles.cache.has(languageDivider.id)) {
          await member.roles.add(languageDivider, "AimDB: adding language divider");
          dividersAdded++;
        }

        const hasVoltaicRole = Array.from(member.roles.cache.keys()).some(id => voltaicRoleIds.has(id));
        const hasViscoseRole = Array.from(member.roles.cache.keys()).some(id => viscoseRoleIds.has(id));
        const hasJPRole = Array.from(member.roles.cache.keys()).some(id => jpRoleIds.has(id));

        if (!hasVoltaicRole) {
          if (unrankedVoltaic && !member.roles.cache.has(unrankedVoltaic.id)) {
            await member.roles.add(unrankedVoltaic, "AimDB: no Voltaic rank, assigning Unranked Voltaic");
            unrankedAdded++;
          }
        } else {
          if (unrankedVoltaic && member.roles.cache.has(unrankedVoltaic.id)) {
            await member.roles.remove(unrankedVoltaic, "AimDB: has Voltaic rank, removing Unranked Voltaic");
            unrankedRemoved++;
          }
        }

        if (!hasViscoseRole) {
          if (unrankedViscose && !member.roles.cache.has(unrankedViscose.id)) {
            await member.roles.add(unrankedViscose, "AimDB: no Viscose rank, assigning Unranked Viscose");
            unrankedAdded++;
          }
        } else {
          if (unrankedViscose && member.roles.cache.has(unrankedViscose.id)) {
            await member.roles.remove(unrankedViscose, "AimDB: has Viscose rank, removing Unranked Viscose");
            unrankedRemoved++;
          }
        }

        if (!hasJPRole) {
          if (unrankedJP && !member.roles.cache.has(unrankedJP.id)) {
            await member.roles.add(unrankedJP, "AimDB: no JP rank, assigning Unranked JP");
            unrankedAdded++;
          }
        } else {
          if (unrankedJP && member.roles.cache.has(unrankedJP.id)) {
            await member.roles.remove(unrankedJP, "AimDB: has JP rank, removing Unranked JP");
            unrankedRemoved++;
          }
        }
      } catch (e: any) {
        console.error(`Failed to sync divider roles for ${member.user.username}:`, e?.message);
      }
    }

    log(`Divider role sync: ${dividersAdded} dividers added, ${unrankedAdded} unranked added, ${unrankedRemoved} unranked removed`, "discord");
  } catch (e: any) {
    console.error("Failed to sync divider roles:", e?.message);
  }
}

async function fixLanguageOrder(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    const { languageDivider } = findDividerRoles(roles.values());

    if (!languageDivider) return;

    const langNameSet = new Set(["french", "german", "russian", "spanish", "english", "dutch", "portuguese"]);
    const langRoles = Array.from(roles.values())
      .filter(r => langNameSet.has(r.name.toLowerCase()))
      .sort((a, b) => b.position - a.position);

    const allRolesInGroup = [languageDivider, ...langRoles];
    const highestPos = Math.max(...allRolesInGroup.map(r => r.position));

    const positionUpdates: { role: string; position: number }[] = [];
    let pos = highestPos;
    positionUpdates.push({ role: languageDivider.id, position: pos });
    pos--;
    for (const r of langRoles) {
      positionUpdates.push({ role: r.id, position: pos });
      pos--;
    }

    const actualUpdates = positionUpdates.filter(u => {
      const existing = roles.get(u.role);
      return existing && existing.position !== u.position;
    });

    if (actualUpdates.length > 0) {
      await guild.roles.setPositions(actualUpdates);
      log(`Fixed language order: ${actualUpdates.length} moves (${langRoles.length} languages)`, "discord");
    }
  } catch (e: any) {
    console.error("Failed to fix language order:", e?.message);
  }
}

async function syncDividerRolesForMember(guild: Guild, memberId: string) {
  try {
    const roles = await guild.roles.fetch();
    let member;
    try {
      member = await guild.members.fetch({ user: memberId, force: true });
    } catch {
      return;
    }
    if (member.user.bot) return;

    const dividers = findDividerRoles(roles.values());

    if (dividers.voltaicDivider && !member.roles.cache.has(dividers.voltaicDivider.id)) {
      await member.roles.add(dividers.voltaicDivider, "AimDB: adding voltaic divider");
    }
    if (dividers.viscoseDivider && !member.roles.cache.has(dividers.viscoseDivider.id)) {
      await member.roles.add(dividers.viscoseDivider, "AimDB: adding viscose divider");
    }
    if (dividers.jpDivider && !member.roles.cache.has(dividers.jpDivider.id)) {
      await member.roles.add(dividers.jpDivider, "AimDB: adding jade palace divider");
    }
    if (dividers.languageDivider && !member.roles.cache.has(dividers.languageDivider.id)) {
      await member.roles.add(dividers.languageDivider, "AimDB: adding language divider");
    }

    const unrankedVoltaic = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("voltaic"));
    const unrankedViscose = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("viscose"));
    const unrankedJP = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("jp"));

    const voltaicRankNames = new Set<string>();
    for (const rank of ALL_VOLTAIC_RANKS) {
      voltaicRankNames.add(`${rank} Complete`);
      voltaicRankNames.add(`${rank} Tracking`);
    }
    const viscoseRankNames = new Set<string>();
    for (const rank of ALL_VISCOSE_RANKS) {
      viscoseRankNames.add(`${rank} Complete`);
      viscoseRankNames.add(`${rank} Tracking`);
    }
    const jpRankNames = new Set<string>();
    for (const rank of JP_EASY_RANKS) {
      jpRankNames.add(`JP Easy ${rank} Complete`);
    }
    for (const rank of JP_HARD_RANKS) {
      jpRankNames.add(`JP Hard ${rank} Complete`);
    }

    const hasVoltaicRole = Array.from(member.roles.cache.values()).some(r => voltaicRankNames.has(r.name));
    const hasViscoseRole = Array.from(member.roles.cache.values()).some(r => viscoseRankNames.has(r.name));
    const hasJPRole = Array.from(member.roles.cache.values()).some(r => jpRankNames.has(r.name));

    if (!hasVoltaicRole) {
      if (unrankedVoltaic && !member.roles.cache.has(unrankedVoltaic.id)) {
        await member.roles.add(unrankedVoltaic, "AimDB: no Voltaic rank, assigning Unranked Voltaic");
      }
    } else {
      if (unrankedVoltaic && member.roles.cache.has(unrankedVoltaic.id)) {
        await member.roles.remove(unrankedVoltaic, "AimDB: has Voltaic rank, removing Unranked Voltaic");
      }
    }

    if (!hasViscoseRole) {
      if (unrankedViscose && !member.roles.cache.has(unrankedViscose.id)) {
        await member.roles.add(unrankedViscose, "AimDB: no Viscose rank, assigning Unranked Viscose");
      }
    } else {
      if (unrankedViscose && member.roles.cache.has(unrankedViscose.id)) {
        await member.roles.remove(unrankedViscose, "AimDB: has Viscose rank, removing Unranked Viscose");
      }
    }

    if (!hasJPRole) {
      if (unrankedJP && !member.roles.cache.has(unrankedJP.id)) {
        await member.roles.add(unrankedJP, "AimDB: no JP rank, assigning Unranked JP");
      }
    } else {
      if (unrankedJP && member.roles.cache.has(unrankedJP.id)) {
        await member.roles.remove(unrankedJP, "AimDB: has JP rank, removing Unranked JP");
      }
    }
  } catch (e: any) {
    console.error(`Failed to sync divider roles for member ${memberId}:`, e?.message);
  }
}

async function consolidateCompleteRoles(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    await guild.members.fetch();

    const allRankNames = ALL_BENCHMARK_RANKS;
    let renamed = 0;
    let deleted = 0;

    for (const rankName of allRankNames) {
      const completeName = `${rankName} Complete`;
      const standalone = roles.find(r => r.name === rankName);
      const dupeCompleteRoles = Array.from(roles.filter(r => r.name === completeName).values());

      if (standalone && dupeCompleteRoles.length > 0) {
        await standalone.setName(completeName, "AimDB: consolidating standalone role to Complete");
        renamed++;
        for (const dupeRole of dupeCompleteRoles) {
          if (dupeRole.id !== standalone.id) {
            const membersWithDupe = Array.from(guild.members.cache.filter(m => m.roles.cache.has(dupeRole.id)).values());
            for (const member of membersWithDupe) {
              try {
                if (!member.roles.cache.has(standalone.id)) {
                  await member.roles.add(standalone, "AimDB: migrating to consolidated Complete role");
                }
              } catch {}
            }
            try {
              await dupeRole.delete("AimDB: removing duplicate Complete role after consolidation");
              deleted++;
            } catch (e: any) {
              console.error(`Failed to delete duplicate "${completeName}":`, e?.message);
            }
          }
        }
      } else if (standalone && dupeCompleteRoles.length === 0) {
        await standalone.setName(completeName, "AimDB: renaming standalone role to Complete");
        renamed++;
      }
    }

    if (renamed > 0 || deleted > 0) {
      log(`Role consolidation: ${renamed} renamed to Complete, ${deleted} duplicates removed`, "discord");
    }
  } catch (e: any) {
    console.error("Failed to consolidate Complete roles:", e?.message);
  }
}

async function ensureTrackingRolesExist(guild: Guild): Promise<Map<string, any>> {
  const roles = await guild.roles.fetch();
  const allTrackingNames = getAllTrackingRoleNames();
  const trackingRoleMap = new Map<string, any>();

  for (const name of allTrackingNames) {
    const color = TRACKING_ROLE_COLORS[name] || 0x95A5A6;
    const existing = roles.find(r => r.name === name);
    if (existing) {
      trackingRoleMap.set(name, existing);
    } else {
      try {
        const created = await guild.roles.create({
          name,
          color,
          reason: "AimDB: auto-created tracking role",
        });
        trackingRoleMap.set(name, created);
        log(`Created missing role "${name}"`, "discord");
      } catch (e: any) {
        console.error(`Failed to create role "${name}":`, e?.message);
      }
    }
  }

  return trackingRoleMap;
}

function buildSectionRoleOrder(rankGroups: string[][], roles: Map<string, any>, trackingRoleMap: Map<string, any>, prefix: string = "", completeOnly: boolean = false, perGroupPrefixes?: string[]): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = [];
  const addedIds = new Set<string>();

  for (let i = 0; i < rankGroups.length; i++) {
    const groupRanks = rankGroups[i];
    const groupPrefix = perGroupPrefixes ? perGroupPrefixes[i] : prefix;
    const ranksHighToLow = [...groupRanks].reverse();

    for (const rank of ranksHighToLow) {
      const completeName = `${groupPrefix}${rank} Complete`;
      const complete = trackingRoleMap.get(completeName) || Array.from(roles.values()).find(r => r.name === completeName);
      if (complete && !addedIds.has(complete.id)) {
        result.push({ id: complete.id, name: completeName });
        addedIds.add(complete.id);
      }

      if (!completeOnly) {
        const trackingName = `${groupPrefix}${rank} Tracking`;
        const tracking = trackingRoleMap.get(trackingName) || Array.from(roles.values()).find(r => r.name === trackingName);
        if (tracking && !addedIds.has(tracking.id)) {
          result.push({ id: tracking.id, name: trackingName });
          addedIds.add(tracking.id);
        }
      }
    }
  }

  return result;
}

async function syncRoleColors(guild: Guild, trackingRoleMap: Map<string, any>) {
  try {
    const roles = await guild.roles.fetch();
    let updated = 0;

    for (const rankName of ALL_BENCHMARK_RANKS) {
      const expectedColor = RANK_COLORS[rankName];
      if (expectedColor === undefined) continue;

      const completeRole = trackingRoleMap.get(`${rankName} Complete`) || roles.find(r => r.name === `${rankName} Complete`);
      const trackingRole = trackingRoleMap.get(`${rankName} Tracking`) || roles.find(r => r.name === `${rankName} Tracking`);

      if (completeRole && completeRole.color !== expectedColor) {
        try {
          await completeRole.setColor(expectedColor, `AimDB: syncing ${rankName} Complete color to EXVL`);
          updated++;
        } catch (e: any) {
          console.error(`Failed to sync color for ${rankName} Complete:`, e?.message);
        }
      }

      if (trackingRole && trackingRole.color !== expectedColor) {
        try {
          await trackingRole.setColor(expectedColor, `AimDB: syncing ${rankName} Tracking color to EXVL`);
          updated++;
        } catch (e: any) {
          console.error(`Failed to sync color for ${rankName} Tracking:`, e?.message);
        }
      }
    }

    if (updated > 0) {
      log(`Synced ${updated} role colors to match EXVL rank colors`, "discord");
    }
  } catch (e: any) {
    console.error("Failed to sync role colors:", e?.message);
  }
}

async function syncRoleIcons(guild: Guild, trackingRoleMap: Map<string, any>) {
  try {
    const roles = await guild.roles.fetch();
    let synced = 0;

    const jpPrefixedNames = [
      ...JP_EASY_RANKS.map(r => `JP Easy ${r}`),
      ...JP_HARD_RANKS.map(r => `JP Hard ${r}`),
    ];
    const allRoleNames = [...ALL_BENCHMARK_RANKS.map(r => r), ...jpPrefixedNames];
    const uniqueRoleNames = Array.from(new Set(allRoleNames));

    for (const rankName of uniqueRoleNames) {
      const completeRole = trackingRoleMap.get(`${rankName} Complete`) || roles.find(r => r.name === `${rankName} Complete`);
      const trackingRole = trackingRoleMap.get(`${rankName} Tracking`) || roles.find(r => r.name === `${rankName} Tracking`);

      if (!completeRole || !trackingRole) continue;

      if (!completeRole.icon) {
        if (trackingRole.icon) {
          try {
            await trackingRole.setIcon(null, `AimDB: removing icon from ${rankName} Tracking (Complete has none)`);
            synced++;
          } catch (e: any) {
            console.error(`Failed to remove icon for ${rankName} Tracking:`, e?.message);
          }
        }
        continue;
      }

      if (trackingRole.icon === completeRole.icon) continue;

      try {
        const pngUrl = completeRole.iconURL({ extension: "png", size: 64 });
        if (!pngUrl) continue;
        const response = await fetch(pngUrl);
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        await trackingRole.setIcon(buffer, `AimDB: copying icon from ${rankName} Complete`);
        synced++;
      } catch (e: any) {
        console.error(`Failed to sync icon for ${rankName} Tracking:`, e?.message);
      }
    }

    const jpIconPairs: { sourceRank: string; jpRoleName: string }[] = [];
    for (const rank of JP_EASY_RANKS) {
      jpIconPairs.push({ sourceRank: rank, jpRoleName: `JP Easy ${rank} Complete` });
    }
    for (const rank of JP_HARD_RANKS) {
      jpIconPairs.push({ sourceRank: rank, jpRoleName: `JP Hard ${rank} Complete` });
    }

    for (const { sourceRank, jpRoleName } of jpIconPairs) {
      const voltaicComplete = trackingRoleMap.get(`${sourceRank} Complete`) || roles.find(r => r.name === `${sourceRank} Complete`);
      if (!voltaicComplete || !voltaicComplete.icon) continue;

      const jpRolesToSync = [
        trackingRoleMap.get(jpRoleName) || roles.find(r => r.name === jpRoleName),
      ];

      for (const jpRole of jpRolesToSync) {
        if (!jpRole) continue;
        if (jpRole.icon === voltaicComplete.icon) continue;

        try {
          const pngUrl = voltaicComplete.iconURL({ extension: "png", size: 64 });
          if (!pngUrl) continue;
          const response = await fetch(pngUrl);
          if (!response.ok) continue;
          const iconBuffer = Buffer.from(await response.arrayBuffer());
          await jpRole.setIcon(iconBuffer, `AimDB: copying icon from Voltaic ${sourceRank} Complete to ${jpRole.name}`);
          synced++;
        } catch (e: any) {
          console.error(`Failed to copy Voltaic icon to ${jpRole.name}:`, e?.message);
        }
      }
    }

    if (synced > 0) {
      log(`Synced ${synced} role icons (Complete→Tracking + Voltaic→JP)`, "discord");
    }
  } catch (e: any) {
    console.error("Failed to sync role icons:", e?.message);
  }
}

async function arrangeAllBenchmarkRoles(guild: Guild, trackingRoleMap: Map<string, any>) {
  try {
    const roles = await guild.roles.fetch();

    const anchors = findDividerRoles(roles.values());
    const voltaicAnchor = anchors.voltaicDivider;
    const viscoseAnchor = anchors.viscoseDivider;
    const jpAnchor = anchors.jpDivider;

    if (!viscoseAnchor && !voltaicAnchor && !jpAnchor) {
      log(`No anchor roles found (Viscose/Voltaic/Jade Palace) — skipping arrangement`, "discord");
      return;
    }

    const botMember = guild.members.me;
    const botHighestPos = botMember ? botMember.roles.highest.position : 0;

    const voltaicOrder = voltaicAnchor ? buildSectionRoleOrder(
      [VOLTAIC_ADV_RANKS, VOLTAIC_INT_RANKS, VOLTAIC_NOV_RANKS],
      roles, trackingRoleMap
    ) : [];

    const viscoseOrder = viscoseAnchor ? buildSectionRoleOrder(
      [VISCOSE_HARD_RANKS, VISCOSE_MEDIUM_RANKS, VISCOSE_EASY_RANKS],
      roles, trackingRoleMap
    ) : [];

    const jpOrder = jpAnchor ? buildSectionRoleOrder(
      [JP_HARD_RANKS, JP_EASY_RANKS],
      roles, trackingRoleMap, "", true,
      ["JP Hard ", "JP Easy "]
    ) : [];

    const unrankedVoltaic = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("voltaic"));
    const unrankedViscose = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("viscose"));
    const unrankedJP = roles.find(r => r.name.toLowerCase().includes("unranked") && r.name.toLowerCase().includes("jp"));

    const arkTierAnchor = roles.find(r => r.name.toLowerCase().includes("ark tier"));
    const tierNameSet = new Set(["S+ Tier", "S Tier", "A+ Tier", "A Tier", "B+ Tier", "B Tier", "C+ Tier", "C Tier"]);
    const arkTierRoles = Array.from(roles.values())
      .filter(r => tierNameSet.has(r.name))
      .sort((a, b) => b.position - a.position);

    const pinnedRoles = Array.from(roles.values())
      .filter(r => r.name.includes("Celestial Tracking S"))
      .sort((a, b) => b.position - a.position);

    const allManagedIds = new Set<string>();
    voltaicOrder.forEach(r => allManagedIds.add(r.id));
    viscoseOrder.forEach(r => allManagedIds.add(r.id));
    jpOrder.forEach(r => allManagedIds.add(r.id));
    pinnedRoles.forEach(r => allManagedIds.add(r.id));
    if (voltaicAnchor) allManagedIds.add(voltaicAnchor.id);
    if (viscoseAnchor) allManagedIds.add(viscoseAnchor.id);
    if (jpAnchor) allManagedIds.add(jpAnchor.id);
    if (unrankedVoltaic) allManagedIds.add(unrankedVoltaic.id);
    if (unrankedViscose) allManagedIds.add(unrankedViscose.id);
    if (unrankedJP) allManagedIds.add(unrankedJP.id);
    if (arkTierAnchor) allManagedIds.add(arkTierAnchor.id);
    arkTierRoles.forEach(r => allManagedIds.add(r.id));

    const allAnchorsAndRoles = [voltaicAnchor, viscoseAnchor, jpAnchor, arkTierAnchor, unrankedVoltaic, unrankedViscose, unrankedJP, ...pinnedRoles, ...voltaicOrder.map(r => roles.get(r.id)), ...viscoseOrder.map(r => roles.get(r.id)), ...jpOrder.map(r => roles.get(r.id)), ...arkTierRoles].filter(Boolean);
    const highestPos = Math.max(...allAnchorsAndRoles.map(r => r!.position));
    const startPos = highestPos;

    const totalManagedSlots = pinnedRoles.length + (voltaicAnchor ? 1 + voltaicOrder.length + (unrankedVoltaic ? 1 : 0) : 0) + (viscoseAnchor ? 1 + viscoseOrder.length + (unrankedViscose ? 1 : 0) : 0) + (jpAnchor ? 1 + jpOrder.length + (unrankedJP ? 1 : 0) : 0) + (arkTierAnchor ? 1 + arkTierRoles.length : 0);
    const lowestManagedPos = startPos - totalManagedSlots + 1;

    const interferingRoles = Array.from(roles.values()).filter(r => {
      if (r.name === "@everyone" || r.managed) return false;
      if (allManagedIds.has(r.id)) return false;
      return r.position >= lowestManagedPos && r.position <= startPos;
    }).sort((a, b) => b.position - a.position);

    const isProtectedRole = (name: string): boolean => {
      const lower = name.toLowerCase();
      if (lower.includes("language") && !lower.includes("french") && !lower.includes("german") && !lower.includes("russian") && !lower.includes("spanish") && !lower.includes("english")) return true;
      return false;
    };

    const movableInterfering: any[] = [];
    for (const r of interferingRoles) {
      if (!isProtectedRole(r.name)) {
        movableInterfering.push(r);
      }
    }

    const positionUpdates: { role: string; position: number }[] = [];
    let pos = startPos;

    if (voltaicAnchor) {
      positionUpdates.push({ role: voltaicAnchor.id, position: pos });
      pos--;
      for (const r of voltaicOrder) {
        positionUpdates.push({ role: r.id, position: pos });
        pos--;
        if (r.name === "Nova Tracking" || r.name === "Nova Complete") {
          const nextRole = voltaicOrder[voltaicOrder.indexOf(r) + 1];
          const isLastNova = !nextRole || !nextRole.name.startsWith("Nova ");
          if (isLastNova) {
            for (const pinned of pinnedRoles) {
              positionUpdates.push({ role: pinned.id, position: pos });
              pos--;
            }
          }
        }
      }
      if (unrankedVoltaic) {
        positionUpdates.push({ role: unrankedVoltaic.id, position: pos });
        pos--;
      }
    }

    if (viscoseAnchor) {
      positionUpdates.push({ role: viscoseAnchor.id, position: pos });
      pos--;
      for (const r of viscoseOrder) {
        positionUpdates.push({ role: r.id, position: pos });
        pos--;
      }
      if (unrankedViscose) {
        positionUpdates.push({ role: unrankedViscose.id, position: pos });
        pos--;
      }
    }

    if (jpAnchor) {
      positionUpdates.push({ role: jpAnchor.id, position: pos });
      pos--;
      for (const r of jpOrder) {
        positionUpdates.push({ role: r.id, position: pos });
        pos--;
      }
      if (unrankedJP) {
        positionUpdates.push({ role: unrankedJP.id, position: pos });
        pos--;
      }
    }

    if (arkTierAnchor) {
      positionUpdates.push({ role: arkTierAnchor.id, position: pos });
      pos--;
      for (const r of arkTierRoles) {
        positionUpdates.push({ role: r.id, position: pos });
        pos--;
      }
    }

    for (const interferingRole of movableInterfering) {
      positionUpdates.push({ role: interferingRole.id, position: pos });
      pos--;
    }

    const actualUpdates = positionUpdates.filter(u => {
      const existing = roles.get(u.role);
      return existing && existing.position !== u.position && u.position < botHighestPos && u.position >= 1;
    });

    if (actualUpdates.length > 0) {
      log(`Arranging roles: Voltaic(${voltaicOrder.length}) + Viscose(${viscoseOrder.length}) + JP(${jpOrder.length}) + ArkTier(${arkTierRoles.length}), ${movableInterfering.length} interfering, ${pinnedRoles.length} pinned`, "discord");
      await guild.roles.setPositions(actualUpdates);
      log(`Arranged ${actualUpdates.length} roles under anchors`, "discord");
    } else {
      log(`Benchmark roles already arranged under anchors`, "discord");
    }
  } catch (e: any) {
    log(`Failed to arrange benchmark roles: ${e?.message}`, "discord");
  }
}

async function syncBenchmarkRoles(guild: Guild) {
  if (syncInProgress) {
    log("Benchmark role sync already in progress, skipping", "discord");
    return;
  }
  syncInProgress = true;
  try {
    const allPlayers = await storage.getPlayers();
    if (allPlayers.length === 0) return;

    log(`Syncing benchmark tracking roles for ${allPlayers.length} players...`, "discord");
    const trackingRoleMap = await ensureTrackingRolesExist(guild);

    let rolesAssigned = 0;
    let rolesRemoved = 0;

    for (let i = 0; i < allPlayers.length; i++) {
      const player = allPlayers[i];
      if (i > 0) await new Promise(r => setTimeout(r, 500));

      try {
        const benchmarks = await getPlayerAllBenchmarks(player.steamId);
        const { desiredRoles } = await getTrackingRolesForPlayer(player.steamId, benchmarks);
        const desiredSet = new Set<string>(desiredRoles);

        log(`${player.discordUsername}: desired=[${desiredRoles.join(", ")}]`, "discord");

        let member;
        try {
          member = await guild.members.fetch({ user: player.discordId, force: true });
        } catch {
          continue;
        }

        const trackingEntries = Array.from(trackingRoleMap.entries());
        for (const [roleName, role] of trackingEntries) {
          const hasRole = member.roles.cache.has(role.id);
          const shouldHave = desiredSet.has(roleName);

          if (shouldHave && !hasRole) {
            try {
              await member.roles.add(role, `AimDB: earned ${roleName}`);
              rolesAssigned++;
            } catch (e: any) {
              console.error(`Failed to add ${roleName} to ${player.discordUsername}:`, e?.message);
            }
          } else if (!shouldHave && hasRole) {
            try {
              await member.roles.remove(role, `AimDB: no longer qualifies for ${roleName}`);
              rolesRemoved++;
            } catch (e: any) {
              console.error(`Failed to remove ${roleName} from ${player.discordUsername}:`, e?.message);
            }
          }
        }
      } catch (e: any) {
        console.error(`Failed to sync benchmark roles for ${player.discordUsername}:`, e?.message);
      }
    }

    log(`Benchmark role sync complete: ${rolesAssigned} assigned, ${rolesRemoved} removed`, "discord");

    const roles = await guild.roles.fetch();
    const staleJPNames = new Set<string>();
    for (const rank of ALL_JP_RANKS) {
      staleJPNames.add(`JP ${rank} Complete`);
      staleJPNames.add(`JP ${rank} Tracking`);
    }
    for (const rank of JP_EASY_RANKS) {
      staleJPNames.add(`JP Easy ${rank} Tracking`);
    }
    for (const rank of JP_HARD_RANKS) {
      staleJPNames.add(`JP Hard ${rank} Tracking`);
    }
    const easyOnlyRanks = JP_EASY_RANKS.filter(r => !JP_HARD_RANKS.includes(r));
    for (const rank of easyOnlyRanks) {
      staleJPNames.add(`JP Hard ${rank} Complete`);
      staleJPNames.add(`JP Hard ${rank} Tracking`);
    }

    const staleJPRoles = Array.from(roles.values()).filter(r => staleJPNames.has(r.name));
    if (staleJPRoles.length > 0) {
      let staleRemoved = 0;
      for (const staleRole of staleJPRoles) {
        const membersWithRole = staleRole.members;
        for (const [, member] of membersWithRole) {
          try {
            await member.roles.remove(staleRole, `AimDB: removing stale JP role ${staleRole.name}`);
            staleRemoved++;
          } catch (e: any) {
            console.error(`Failed to remove stale role ${staleRole.name} from ${member.user.username}:`, e?.message);
          }
        }
        try {
          await staleRole.delete(`AimDB: deleting stale JP role ${staleRole.name}`);
          log(`Deleted stale JP role: ${staleRole.name}`, "discord");
        } catch (e: any) {
          console.error(`Failed to delete stale role ${staleRole.name}:`, e?.message);
        }
      }
      if (staleRemoved > 0) {
        log(`Removed ${staleRemoved} stale JP role assignments and deleted stale roles`, "discord");
      }
    }

    await syncRoleColors(guild, trackingRoleMap);
    await syncRoleIcons(guild, trackingRoleMap);
    await arrangeAllBenchmarkRoles(guild, trackingRoleMap);
  } catch (e: any) {
    console.error("Failed to sync benchmark roles:", e?.message);
  } finally {
    syncInProgress = false;
  }
}

async function syncBenchmarkRolesForPlayer(guild: Guild, discordId: string, steamId: string) {
  try {
    const trackingRoleMap = await ensureTrackingRolesExist(guild);
    const benchmarks = await getPlayerAllBenchmarks(steamId);
    const { desiredRoles } = await getTrackingRolesForPlayer(steamId, benchmarks);
    const desiredSet = new Set<string>(desiredRoles);

    let member;
    try {
      member = await guild.members.fetch({ user: discordId, force: true });
    } catch {
      return;
    }

    const trackingEntries = Array.from(trackingRoleMap.entries());
    const rolesToAdd: any[] = [];
    const rolesToRemove: any[] = [];
    for (const [roleName, role] of trackingEntries) {
      const hasRole = member.roles.cache.has(role.id);
      const shouldHave = desiredSet.has(roleName);
      if (shouldHave && !hasRole) {
        rolesToAdd.push(role);
        log(`Adding "${roleName}" to ${member.user.username}`, "discord");
      } else if (!shouldHave && hasRole) {
        rolesToRemove.push(role);
        log(`Removing "${roleName}" from ${member.user.username}`, "discord");
      }
    }
    if (rolesToAdd.length > 0) {
      try {
        await member.roles.add(rolesToAdd, "AimDB: earned benchmark roles");
      } catch (e: any) {
        console.error(`Failed to add roles to ${member.user.username}:`, e?.message);
      }
    }
    if (rolesToRemove.length > 0) {
      try {
        await member.roles.remove(rolesToRemove, "AimDB: no longer qualifies for benchmark roles");
      } catch (e: any) {
        console.error(`Failed to remove roles from ${member.user.username}:`, e?.message);
      }
    }
  } catch (e: any) {
    console.error(`Failed to sync benchmark roles for ${discordId}:`, e?.message);
  }
}

async function findOrCreateLinkedRole(guild: Guild) {
  try {
    const roles = await guild.roles.fetch();
    log(`Fetched ${roles.size} roles from guild ${guild.id} (${guild.name})`, "discord");
    const linked = roles.find(r => r.name.toLowerCase() === "linked");
    if (linked) return linked;

    const created = await guild.roles.create({
      name: "Linked",
      color: 0x7C3AED,
      reason: "AimDB: auto-created role for linked players",
    });
    log(`Created "Linked" role in guild ${guild.id}`, "discord");
    return created;
  } catch (e: any) {
    console.error("Failed to find/create Linked role:", e?.code, e?.message || e);
    return null;
  }
}

async function assignLinkedRole(guild: Guild, userId: string) {
  try {
    log(`Assigning linked role in guild ${guild.id} to user ${userId}`, "discord");
    const role = await findOrCreateLinkedRole(guild);
    if (!role) {
      log("Could not get or create Linked role — bot may lack Manage Roles permission", "discord");
      return;
    }
    const member = await guild.members.fetch(userId);
    await member.roles.add(role, "AimDB: player linked");
    log(`Assigned Linked role to user ${userId}`, "discord");
  } catch (e: any) {
    console.error("Failed to assign linked role:", e?.code, e?.message || e);
  }
}

async function removeLinkedRole(guild: Guild, userId: string) {
  try {
    const roles = await guild.roles.fetch();
    const linked = roles.find(r => r.name.toLowerCase() === "linked");
    if (!linked) return;
    const member = await guild.members.fetch(userId);
    await member.roles.remove(linked, "AimDB: player unlinked");
    log(`Removed Linked role from user ${userId}`, "discord");
  } catch (e: any) {
    console.error("Failed to remove linked role:", e?.code, e?.message || e);
  }
}

async function collectActivitySnapshots() {
  try {
    const players = await storage.getPlayers();
    log(`Collecting activity snapshots for ${players.length} players...`, "discord");

    for (const player of players) {
      try {
        const [kovaaksMinutes, benchmarks] = await Promise.all([
          getKovaaksRecentPlaytime(player.steamId),
          getPlayerAllBenchmarks(player.steamId),
        ]);

        const energies: Record<string, number> = {};
        for (const b of benchmarks) {
          energies[`${b.benchmarkId}`] = b.energy;
        }

        await storage.saveActivitySnapshot(player.steamId, kovaaksMinutes, energies);
      } catch (e: any) {
        console.error(`Failed to collect snapshot for ${player.discordUsername}:`, e?.message);
      }
    }

    log(`Activity snapshots collected for ${players.length} players`, "discord");
  } catch (e: any) {
    console.error("Failed to collect activity snapshots:", e?.message);
  }
}

client.on("ready", async () => {
  log(`Bot logged in as ${client.user?.tag}`, "discord");
  log(`Serving ${client.guilds.cache.size} server(s)`, "discord");

  try {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    log(`Successfully fetched guild: ${guild.name} (${guild.id})`, "discord");
    const roles = await guild.roles.fetch();
    const members = await guild.members.fetch();
    log(`Guild has ${roles.size} roles, ${members.size} members`, "discord");

    const allRankSet = new Set(ALL_BENCHMARK_RANKS);
    const allTrackingNames = new Set(getAllTrackingRoleNames());
    const benchmarkRoles: string[] = [];
    const systemRoles: string[] = [];
    const otherRoles: string[] = [];

    const sortedRoles = Array.from(roles.values()).sort((a, b) => b.position - a.position);
    for (const role of sortedRoles) {
      if (role.name === "@everyone") continue;
      const memberCount = members.filter(m => m.roles.cache.has(role.id)).size;
      const entry = `  ${role.position.toString().padStart(3)}. ${role.name} (${memberCount} members, color: #${role.color.toString(16).padStart(6, "0")})`;

      if (allTrackingNames.has(role.name) || allRankSet.has(role.name)) {
        benchmarkRoles.push(entry);
      } else if (["Linked", "Guest", "goat"].includes(role.name) || role.name.toLowerCase().includes("viscose") || role.name.toLowerCase().includes("voltaic")) {
        systemRoles.push(entry);
      } else {
        otherRoles.push(entry);
      }
    }

    log(`--- Server Role Audit ---`, "discord");
    if (systemRoles.length > 0) {
      log(`System/Anchor roles (${systemRoles.length}):`, "discord");
      systemRoles.forEach(r => log(r, "discord"));
    }
    if (benchmarkRoles.length > 0) {
      log(`Benchmark roles (${benchmarkRoles.length}):`, "discord");
      benchmarkRoles.forEach(r => log(r, "discord"));
    }
    if (otherRoles.length > 0) {
      log(`Other roles (${otherRoles.length}):`, "discord");
      otherRoles.forEach(r => log(r, "discord"));
    }
    log(`--- End Role Audit ---`, "discord");

    const players = await storage.getPlayers();
    const linkedRole = roles.find(r => r.name === "Linked");
    const linkedCount = linkedRole ? members.filter(m => m.roles.cache.has(linkedRole.id)).size : 0;
    const botCount = members.filter(m => m.user.bot).size;
    log(`Server summary: ${members.size} members (${botCount} bots), ${players.length} tracked players, ${linkedCount} linked`, "discord");
  } catch (e: any) {
    log(`Failed to fetch target guild: ${e?.code} ${e?.status} ${e?.message}`, "discord");
  }

  try {
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
    if (targetGuild) {
      await syncServerTagRole(targetGuild);
      await syncGuestRole(targetGuild);
    }
  } catch (e: any) {
    console.error("Failed to run initial sync:", e?.message);
  }

  setTimeout(() => collectActivitySnapshots(), 10000);
  setInterval(() => collectActivitySnapshots(), 6 * 60 * 60 * 1000);

  setTimeout(async () => {
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
    if (targetGuild) {
      try {
        const roles = await targetGuild.roles.fetch();
        const desiredJPName = "\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200Bjade palace\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B";
        const jpDivider = roles.find(r => r.name.toLowerCase().includes("jade palace") && !r.name.includes("Complete") && !r.name.startsWith("JP "));
        if (jpDivider && jpDivider.name !== desiredJPName) {
          await jpDivider.setName(desiredJPName, "AimDB: formatting jade palace divider");
          log(`Renamed jade palace divider with spacing characters`, "discord");
        }
      } catch (e: any) {
        console.error("Failed to clean up JP roles:", e?.message);
      }

      await consolidateCompleteRoles(targetGuild);
      await syncBenchmarkRoles(targetGuild);
      await syncDividerAndUnrankedRoles(targetGuild);
      await fixLanguageOrder(targetGuild);
    }
  }, 30000);

  setInterval(async () => {
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
    if (targetGuild) await syncBenchmarkRoles(targetGuild);
  }, 6 * 60 * 60 * 1000);
});

client.on("guildMemberAdd", async (member) => {
  try {
    if (member.user.bot) return;
    log(`New member joined: ${member.user.username}`, "discord");
    await syncDividerRolesForMember(member.guild, member.id);
    const guestRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === "guest");
    if (guestRole && !member.roles.cache.has(guestRole.id)) {
      await member.roles.add(guestRole, "AimDB: new member, assigning guest");
    }
  } catch (e: any) {
    console.error(`Failed to handle new member ${member.user.username}:`, e?.message);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (newMember.user.bot) return;
    const oldRepresenting = memberIsRepresentingGuild(oldMember as GuildMember);
    const newRepresenting = memberIsRepresentingGuild(newMember as GuildMember);
    if (oldRepresenting === newRepresenting) return;

    const goatRole = await findGoatRole(newMember.guild);
    if (!goatRole) return;

    if (newRepresenting && !newMember.roles.cache.has(goatRole.id)) {
      await newMember.roles.add(goatRole, "AimDB: member started using server tag");
      log(`Added goat role to ${newMember.user.username}`, "discord");
    } else if (!newRepresenting && newMember.roles.cache.has(goatRole.id)) {
      await newMember.roles.remove(goatRole, "AimDB: member stopped using server tag");
      log(`Removed goat role from ${newMember.user.username}`, "discord");
    }
  } catch (e: any) {
    console.error("Error handling server tag role update:", e?.message);
  }
});

client.on("userUpdate", async (oldUser, newUser) => {
  try {
    if (newUser.bot) return;
    const oldPG = (oldUser as any).primaryGuild;
    const newPG = (newUser as any).primaryGuild;
    const oldGuildId = oldPG?.identityGuildId;
    const newGuildId = newPG?.identityGuildId;
    const oldEnabled = oldPG?.identityEnabled === true;
    const newEnabled = newPG?.identityEnabled === true;

    if (oldGuildId === newGuildId && oldEnabled === newEnabled) return;

    const guild = client.guilds.cache.get(TARGET_GUILD_ID);
    if (!guild) return;

    const wasRepresenting = oldGuildId === TARGET_GUILD_ID && oldEnabled;
    const nowRepresenting = newGuildId === TARGET_GUILD_ID && newEnabled;
    if (wasRepresenting === nowRepresenting) return;

    const goatRole = await findGoatRole(guild);
    if (!goatRole) return;

    const member = await guild.members.fetch(newUser.id).catch(() => null);
    if (!member) return;

    if (nowRepresenting && !member.roles.cache.has(goatRole.id)) {
      await member.roles.add(goatRole, "AimDB: member started using server tag");
      log(`Added goat role to ${newUser.username} (via userUpdate)`, "discord");
    } else if (!nowRepresenting && member.roles.cache.has(goatRole.id)) {
      await member.roles.remove(goatRole, "AimDB: member stopped using server tag");
      log(`Removed goat role from ${newUser.username} (via userUpdate)`, "discord");
    }
  } catch (e: any) {
    console.error("Error handling userUpdate for server tag:", e?.message);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "aimdb") {
      await interaction.deferReply();
      await interaction.editReply(await buildMainMenu());
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "aimdb-admin") {
      if (!checkIsAdmin(interaction)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Permission Denied")
              .setDescription("You need the **Council** role or **Manage Server** permission to use this command.")
          ],
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(buildAdminMenu());
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isUserSelectMenu()) {
      await handleUserSelect(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }
  } catch (error) {
    console.error("Interaction error:", error);
    const msg = { content: "Something went wrong. Please try again.", ephemeral: true };
    try {
      if ("replied" in interaction && ((interaction as any).replied || (interaction as any).deferred)) {
        await (interaction as any).followUp(msg);
      } else if ("reply" in interaction) {
        await (interaction as any).reply(msg);
      }
    } catch {
      // Interaction may have expired, nothing we can do
    }
  }
});

async function handleButton(interaction: ButtonInteraction) {
  switch (interaction.customId) {
    case "menu_myprofile": {
      const player = await storage.getPlayerByDiscordId(interaction.user.id);
      if (!player) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Not Linked")
              .setDescription("You're not in the tracker yet. Ask an admin to add you with your Steam ID.")
          ],
          components: [backButton()],
          ephemeral: true,
        });
        break;
      }

      await interaction.deferReply({ ephemeral: true });

      const [steamProfiles, benchmarks] = await Promise.all([
        getSteamPlayerSummaries([player.steamId]),
        getPlayerAllBenchmarks(player.steamId),
      ]);
      const steam = steamProfiles.length > 0 ? steamProfiles[0] : null;

      const livePositions = new Map<number, number | null>();
      await Promise.all(
        TRACKED_BENCHMARKS.map(async (bench) => {
          const progress = await getKovaaksBenchmarkProgress(player.steamId, bench.id);
          livePositions.set(bench.id, progress ? getAvgLeaderboardRank(progress) : null);
        })
      );

      const embed = buildProfileEmbed(player, steam, benchmarks, livePositions);
      await interaction.editReply({
        embeds: [embed],
        components: [backButton()],
      });
      break;
    }

    case "menu_stats": {
      const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("select_stats")
          .setPlaceholder("Select a player to look up")
          .setMinValues(1)
          .setMaxValues(1)
      );
      await interaction.reply({
        content: "Select a player to look up their EXVL tracker:",
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case "menu_listplayers": {
      await handleListPlayers(interaction);
      break;
    }

    case "menu_addplayer": {
      if (!checkIsAdmin(interaction)) {
        await denyPermission(interaction);
        return;
      }
      const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("select_addplayer")
          .setPlaceholder("Select a Discord user to add")
          .setMinValues(1)
          .setMaxValues(1)
      );
      await interaction.reply({
        content: "Select the Discord user you want to add to the tracker:",
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case "menu_updateplayer": {
      if (!checkIsAdmin(interaction)) {
        await denyPermission(interaction);
        return;
      }
      const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("select_updateplayer")
          .setPlaceholder("Select a player to update")
          .setMinValues(1)
          .setMaxValues(1)
      );
      await interaction.reply({
        content: "Select the Discord user whose Steam ID you want to update:",
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case "menu_removeplayer": {
      if (!checkIsAdmin(interaction)) {
        await denyPermission(interaction);
        return;
      }
      const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("select_removeplayer")
          .setPlaceholder("Select a player to remove")
          .setMinValues(1)
          .setMaxValues(1)
      );
      await interaction.reply({
        content: "Select the Discord user you want to remove from the tracker:",
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case "menu_updateroles": {
      await handleUpdateMyRoles(interaction);
      break;
    }

    case "menu_leaderboard": {
      await handleLeaderboard(interaction);
      break;
    }

    case "menu_nowplaying": {
      await handleNowPlaying(interaction);
      break;
    }

    case "menu_activity": {
      await handleActivity(interaction);
      break;
    }

    case "menu_back": {
      await interaction.deferUpdate();
      await interaction.editReply(await buildMainMenu());
      break;
    }
  }
}

async function handleUserSelect(interaction: UserSelectMenuInteraction) {
  const selectedUser = interaction.users.first();
  if (!selectedUser) return;

  const customId = interaction.customId;
  switch (customId) {
    case "select_stats": {
      const player = await storage.getPlayerByDiscordId(selectedUser.id);
      if (!player) {
        await interaction.update({
          content: null,
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Player Not Found")
              .setDescription(`**${selectedUser.username}** is not in the tracker database.`)
          ],
          components: [backButton()],
        });
        return;
      }

      await interaction.deferUpdate();

      const [steamProfiles, benchmarks] = await Promise.all([
        getSteamPlayerSummaries([player.steamId]),
        getPlayerAllBenchmarks(player.steamId),
      ]);
      const steam = steamProfiles.length > 0 ? steamProfiles[0] : null;

      const livePositions = new Map<number, number | null>();
      await Promise.all(
        TRACKED_BENCHMARKS.map(async (bench) => {
          const progress = await getKovaaksBenchmarkProgress(player.steamId, bench.id);
          livePositions.set(bench.id, progress ? getAvgLeaderboardRank(progress) : null);
        })
      );

      const embed = buildProfileEmbed(player, steam, benchmarks, livePositions);
      await interaction.editReply({
        content: null,
        embeds: [embed],
        components: [backButton()],
      });
      break;
    }

    case "select_addplayer": {
      if (!checkIsAdmin(interaction)) { await denyPermission(interaction); return; }
      const existing = await storage.getPlayerByDiscordId(selectedUser.id);
      if (existing) {
        await interaction.update({
          content: null,
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Already Exists")
              .setDescription(`**${selectedUser.username}** is already in the database with Steam ID \`${existing.steamId}\`.`)
          ],
          components: [backButton()],
        });
        return;
      }

      if (interaction.guildId) {
        const mapKey = `add_${selectedUser.id}_${interaction.user.id}`;
        pendingGuildMap.set(mapKey, interaction.guildId);
        setTimeout(() => pendingGuildMap.delete(mapKey), 5 * 60 * 1000);
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_addplayer_${selectedUser.id}`)
        .setTitle(`Add ${selectedUser.username}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("steamid")
              .setLabel("Steam ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("e.g. 76561198012345678")
          ),
        );
      await interaction.showModal(modal);
      break;
    }

    case "select_updateplayer": {
      if (!checkIsAdmin(interaction)) { await denyPermission(interaction); return; }
      const player = await storage.getPlayerByDiscordId(selectedUser.id);
      if (!player) {
        await interaction.update({
          content: null,
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Player Not Found")
              .setDescription(`**${selectedUser.username}** is not in the database. Add them first.`)
          ],
          components: [backButton()],
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_updateplayer_${selectedUser.id}`)
        .setTitle(`Update ${selectedUser.username}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("steamid")
              .setLabel("New Steam ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(player.steamId)
              .setPlaceholder("e.g. 76561198012345678")
          ),
        );
      await interaction.showModal(modal);
      break;
    }

    case "select_removeplayer": {
      if (!checkIsAdmin(interaction)) { await denyPermission(interaction); return; }
      const player = await storage.getPlayerByDiscordId(selectedUser.id);
      if (!player) {
        await interaction.update({
          content: null,
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF4444)
              .setTitle("Player Not Found")
              .setDescription(`**${selectedUser.username}** is not in the database.`)
          ],
          components: [backButton()],
        });
        return;
      }

      await storage.deletePlayer(player.id);

      if (interaction.guild) {
        await removeLinkedRole(interaction.guild, selectedUser.id);
      } else if (interaction.guildId) {
        try {
          const guild = await client.guilds.fetch(interaction.guildId);
          await removeLinkedRole(guild, selectedUser.id);
        } catch (e: any) {
          console.error("Failed to fetch guild for role removal:", e?.message);
        }
      }

      await interaction.update({
        content: null,
        embeds: [
          new EmbedBuilder()
            .setColor(0xEF4444)
            .setTitle("Player Removed")
            .setDescription(`**${player.discordUsername}** (\`${player.steamId}\`) has been removed and their Linked role was removed.`)
        ],
        components: [backButton()],
      });
      break;
    }
  }
}

function backButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("menu_back")
      .setLabel("Back to Menu")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️")
  );
}

async function denyPermission(interaction: ButtonInteraction | UserSelectMenuInteraction) {
  const msg = {
    embeds: [
      new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle("Permission Denied")
        .setDescription("You need the **Council** role or **Manage Server** permission to use this action.")
    ],
    components: [backButton()],
    ephemeral: true,
  };
  if (interaction.isUserSelectMenu()) {
    await interaction.update({ ...msg, content: null });
  } else {
    await interaction.reply(msg);
  }
}

async function handleListPlayers(interaction: ButtonInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const players = await storage.getPlayers();
  if (players.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B7280)
          .setTitle("No Players")
          .setDescription("The tracker database is empty.")
      ],
      components: [backButton()],
    });
    return;
  }

  const playerList = players.map((p, i) =>
    `**${i + 1}.** <@${p.discordId}> — [${p.steamId}](https://evxl.app/u/${p.steamId})`
  ).join("\n");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle(`Tracked Players (${players.length})`)
        .setDescription(truncateDescription(playerList))
        .setTimestamp()
    ],
    components: [backButton()],
  });
}

async function handleUpdateMyRoles(interaction: ButtonInteraction) {
  const discordId = interaction.user.id;
  const player = await storage.getPlayerByDiscordId(discordId);

  if (!player) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xEF4444)
          .setTitle("Not Linked")
          .setDescription("You're not in the tracker yet. Ask an admin to add you with `/aimdb-admin`.")
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: "Could not find the server." });
    return;
  }

  await syncBenchmarkRolesForPlayer(guild, discordId, player.steamId);
  await syncDividerRolesForMember(guild, discordId);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x10B981)
        .setTitle("Roles Updated")
        .setDescription("Your benchmark roles have been refreshed based on your latest scenario PBs.")
    ],
    components: [backButton()],
  });
}

async function handleLeaderboard(interaction: ButtonInteraction) {
  const players = await storage.getPlayers();
  if (players.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B7280)
          .setTitle("No Players")
          .setDescription("No tracked players to show a leaderboard for.")
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const viscoseBenches = TRACKED_BENCHMARKS.filter(b => [686, 687, 688].includes(b.id));
  const voltaicBenches = TRACKED_BENCHMARKS.filter(b => [459, 458, 460].includes(b.id));
  const jpBenches = TRACKED_BENCHMARKS.filter(b => JP_BENCHMARK_IDS.has(b.id));

  // Fetch one benchmark at a time to avoid blasting the API with N*M concurrent requests
  const allResults: { bench: typeof TRACKED_BENCHMARKS[0]; results: { player: typeof players[0]; benchmark: ExvlBenchmarkEntry | null; avgPos: number | null }[] }[] = [];
  for (const bench of TRACKED_BENCHMARKS) {
    const results = await Promise.all(
      players.map(async (p) => {
        const benchmark = await getExvlBenchmark(p.steamId, bench.id);
        return { player: p, benchmark, avgPos: null as number | null };
      })
    );
    allResults.push({ bench, results });
  }

  const resultMap = new Map(allResults.map(r => [r.bench.id, r.results]));

  const medalEmojis = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
  const MAX_PER_BENCH = 10;

  function buildRankedLines(benchId: number): string[] {
    const results = resultMap.get(benchId) || [];
    const ranked = results
      .filter(r => r.benchmark !== null || r.avgPos !== null)
      .sort((a, b) => {
        const aEnergy = a.benchmark?.energy ?? 0;
        const bEnergy = b.benchmark?.energy ?? 0;
        if (bEnergy !== aEnergy) return bEnergy - aEnergy;
        const aPos = a.avgPos ?? a.benchmark?.position ?? Infinity;
        const bPos = b.avgPos ?? b.benchmark?.position ?? Infinity;
        return aPos - bPos;
      })
      .slice(0, MAX_PER_BENCH);

    return ranked.map((r, i) => {
      const medal = i < 3 ? medalEmojis[i] : `**${i + 1}.**`;
      const b = r.benchmark;
      const pos = r.avgPos ? `#${r.avgPos}` : (b ? `#${b.position}` : "");
      const progress = b ? (b.progress <= 1 ? b.progress * 100 : b.progress) : 0;
      let info: string;
      if (b && b.rankName !== "Unranked") {
        info = `**${b.rankName}**${pos ? ` \u00B7 ${pos}` : ""}`;
      } else if (progress > 0) {
        info = `${progress.toFixed(0)}%${pos ? ` \u00B7 ${pos}` : ""}`;
      } else {
        info = pos ? `${pos}` : "Ranked";
      }
      return `${medal} <@${r.player.discordId}> \u2014 ${info}`;
    });
  }

  function buildSection(title: string, benches: typeof TRACKED_BENCHMARKS, stripPrefix: string): string | null {
    const parts: string[] = [];
    for (const bench of benches) {
      const lines = buildRankedLines(bench.id);
      if (lines.length === 0) continue;
      const diffName = bench.name.replace(stripPrefix, "");
      parts.push(`**${diffName}**\n${lines.join("\n")}`);
    }
    if (parts.length === 0) return null;
    return `__**${title}**__\n${parts.join("\n\n")}`;
  }

  const sections = [
    buildSection("Viscose", viscoseBenches, "Viscose "),
    buildSection("Voltaic S5", voltaicBenches, "Voltaic S5 "),
    buildSection("Jade Palace Ground", jpBenches, "JP Ground "),
  ].filter((s): s is string => s !== null);

  if (sections.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B7280)
          .setTitle("Leaderboard")
          .setDescription("No tracked players have benchmark data yet.")
      ],
      components: [backButton()],
    });
    return;
  }

  const desc = truncateDescription(sections.join("\n\n"));

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle("Leaderboard")
        .setDescription(desc)
        .setTimestamp()
    ],
    components: [backButton()],
  });
}

async function handleNowPlaying(interaction: ButtonInteraction) {
  const players = await storage.getPlayers();
  if (players.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B7280)
          .setTitle("Now Playing")
          .setDescription("No tracked players in the database.")
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const steamIds = players.map(p => p.steamId);
  const summaries = await getSteamPlayerSummaries(steamIds);
  const steamMap = new Map(summaries.map(s => [s.steamid, s]));

  const playingKovaaks: { player: typeof players[0]; steam: SteamPlayerSummary }[] = [];
  const playingArk: { player: typeof players[0]; steam: SteamPlayerSummary }[] = [];
  const playingOther: { player: typeof players[0]; steam: SteamPlayerSummary; gameName: string }[] = [];

  for (const p of players) {
    const steam = steamMap.get(p.steamId);
    if (!steam || !steam.gameid) continue;
    const appId = parseInt(steam.gameid);
    if (appId === KOVAAKS_APP_ID) {
      playingKovaaks.push({ player: p, steam });
    } else if (appId === 346110 || appId === 2399830) {
      playingArk.push({ player: p, steam });
    } else if (steam.gameextrainfo) {
      playingOther.push({ player: p, steam, gameName: steam.gameextrainfo });
    }
  }

  const sections: string[] = [];
  if (playingKovaaks.length > 0) {
    const lines = playingKovaaks.map(r => `<@${r.player.discordId}>`).join(", ");
    sections.push(`\u{1F3AF} **KovaaK's** (${playingKovaaks.length})\n${lines}`);
  }
  if (playingArk.length > 0) {
    const lines = playingArk.map(r => `<@${r.player.discordId}>`).join(", ");
    sections.push(`\u{1F996} **Ark Survival** (${playingArk.length})\n${lines}`);
  }
  if (playingOther.length > 0) {
    const lines = playingOther.map(r => `<@${r.player.discordId}> \u2014 ${r.gameName}`).join("\n");
    sections.push(`\u{1F3AE} **Other Games** (${playingOther.length})\n${lines}`);
  }

  const totalPlaying = playingKovaaks.length + playingArk.length + playingOther.length;
  const onlineCount = summaries.filter(s => s.personastate > 0).length;

  if (sections.length === 0) {
    sections.push("Nobody is playing KovaaK's or Ark right now.");
  }

  const description = truncateDescription(sections.join("\n\n"));

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(totalPlaying > 0 ? 0x22C55E : 0x6B7280)
        .setTitle("\u{1F3AE} Now Playing")
        .setDescription(description)
        .setFooter({ text: `${onlineCount} online \u00B7 ${players.length} tracked` })
        .setTimestamp()
    ],
    components: [backButton()],
  });
}

async function handleActivity(interaction: ButtonInteraction) {
  const players = await storage.getPlayers();
  if (players.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6B7280)
          .setTitle("Activity")
          .setDescription("No tracked players in the database.")
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const activityData = await Promise.all(
    players.map(async (player) => {
      const [kovaaksMinutes, latestSnap] = await Promise.all([
        getKovaaksRecentPlaytime(player.steamId),
        storage.getLatestSnapshot(player.steamId),
      ]);

      let totalEnergyChange = 0;
      if (latestSnap) {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const oldSnaps = await storage.getSnapshotsSince(player.steamId, weekAgo);
        if (oldSnaps.length >= 2) {
          const oldest = oldSnaps[0];
          const newest = oldSnaps[oldSnaps.length - 1];
          const oldEnergies = (oldest.benchmarkEnergies || {}) as Record<string, number>;
          const newEnergies = (newest.benchmarkEnergies || {}) as Record<string, number>;
          for (const key of Object.keys(newEnergies)) {
            const diff = newEnergies[key] - (oldEnergies[key] || 0);
            if (diff > 0) totalEnergyChange += diff;
          }
        }
      }

      return {
        player,
        kovaaksHours2w: Math.round(kovaaksMinutes / 60 * 10) / 10,
        totalEnergyChange: Math.round(totalEnergyChange * 10) / 10,
      };
    })
  );

  const grinders = activityData
    .filter(d => d.kovaaksHours2w > 0)
    .sort((a, b) => b.kovaaksHours2w - a.kovaaksHours2w);

  const inactive = activityData
    .filter(d => d.kovaaksHours2w === 0);

  const improvers = activityData
    .filter(d => d.totalEnergyChange > 0)
    .sort((a, b) => b.totalEnergyChange - a.totalEnergyChange);

  const sections: string[] = [];

  if (grinders.length > 0) {
    const lines = grinders.map((d, i) => {
      const bar = "\u2593".repeat(Math.min(Math.round(d.kovaaksHours2w / 5), 10));
      return `${i + 1}. <@${d.player.discordId}> \u2014 **${d.kovaaksHours2w}h** ${bar}`;
    });
    sections.push(`\u{1F525} **Grinders** (last 2 weeks)\n${lines.join("\n")}`);
  }

  if (improvers.length > 0) {
    const lines = improvers.slice(0, 10).map((d, i) => {
      return `${i + 1}. <@${d.player.discordId}> \u2014 **+${d.totalEnergyChange}** energy`;
    });
    sections.push(`\u{1F4C8} **Most Improved** (last 7 days)\n${lines.join("\n")}`);
  }

  if (inactive.length > 0) {
    const mentions = inactive.map(d => `<@${d.player.discordId}>`).join(", ");
    sections.push(`\u{1F4A4} **Inactive** (0h in KovaaK's)\n${mentions}`);
  }

  if (sections.length === 0) {
    sections.push("No activity data available yet. Data is collected every 6 hours.");
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle("\u{1F4C8} Activity Report")
        .setDescription(truncateDescription(sections.join("\n\n")))
        .setFooter({ text: `${grinders.length} active \u00B7 ${inactive.length} inactive \u00B7 ${players.length} tracked` })
        .setTimestamp()
    ],
    components: [backButton()],
  });
}

async function handleModal(interaction: ModalSubmitInteraction) {
  const customId = interaction.customId;

  if (customId.startsWith("modal_addplayer_")) {
    if (!checkIsAdmin(interaction)) {
      await interaction.reply({ content: "Permission denied.", ephemeral: true });
      return;
    }

    const discordId = customId.replace("modal_addplayer_", "");
    const steamId = interaction.fields.getTextInputValue("steamid").trim();

    if (!/^7656119\d{10}$/.test(steamId)) {
      await interaction.reply({
        content: "Invalid Steam ID. Must be a 17-digit Steam ID 64 (e.g. 76561198012345678).",
        ephemeral: true,
      });
      return;
    }

    let discordUsername = discordId;
    try {
      const user = await client.users.fetch(discordId);
      discordUsername = user.username;
    } catch (e) {}

    const existing = await storage.getPlayerByDiscordId(discordId);
    if (existing) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle("Already Exists")
            .setDescription(`**${discordUsername}** is already in the database.`)
        ],
        components: [backButton()],
        ephemeral: true,
      });
      return;
    }

    const player = await storage.createPlayer({ discordId, discordUsername, steamId });

    const mapKey = `add_${discordId}_${interaction.user.id}`;
    const guildId = pendingGuildMap.get(mapKey) || interaction.guildId;
    pendingGuildMap.delete(mapKey);

    if (guildId) {
      try {
        const guild = await client.guilds.fetch(guildId);
        await assignLinkedRole(guild, discordId);
        syncDividerRolesForMember(guild, discordId).catch(e => console.error("Divider role sync failed:", e?.message));
        syncBenchmarkRolesForPlayer(guild, discordId, steamId).catch(e => console.error("Benchmark role sync failed:", e?.message));
      } catch (e: any) {
        console.error("Failed to fetch guild for role assignment:", e?.message);
        log(`Could not fetch guild ${guildId} — role not assigned`, "discord");
      }
    } else {
      log(`No guild ID available — cannot assign linked role`, "discord");
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x22C55E)
          .setTitle("Player Added")
          .setDescription(`Successfully added **${player.discordUsername}** to the tracker and assigned the **Linked** role.`)
          .addFields(
            { name: "Discord", value: `<@${player.discordId}>`, inline: true },
            { name: "Steam ID", value: `\`${player.steamId}\``, inline: true },
            { name: "EXVL Tracker", value: `[**Open Benchmarks**](https://evxl.app/u/${player.steamId})` },
          )
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }

  if (customId.startsWith("modal_updateplayer_")) {
    if (!checkIsAdmin(interaction)) {
      await interaction.reply({ content: "Permission denied.", ephemeral: true });
      return;
    }

    const discordId = customId.replace("modal_updateplayer_", "");
    const newSteamId = interaction.fields.getTextInputValue("steamid").trim();

    if (!/^7656119\d{10}$/.test(newSteamId)) {
      await interaction.reply({
        content: "Invalid Steam ID. Must be a 17-digit Steam ID 64 (e.g. 76561198012345678).",
        ephemeral: true,
      });
      return;
    }

    let discordUsername = discordId;
    try {
      const user = await client.users.fetch(discordId);
      discordUsername = user.username;
    } catch (e) {}

    const player = await storage.getPlayerByDiscordId(discordId);
    if (!player) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle("Player Not Found")
            .setDescription(`**${discordUsername}** is not in the database.`)
        ],
        components: [backButton()],
        ephemeral: true,
      });
      return;
    }

    const updated = await storage.updatePlayer(player.id, { steamId: newSteamId });

    const updateGuildId = interaction.guildId;
    if (updateGuildId) {
      try {
        const guild = await client.guilds.fetch(updateGuildId);
        syncBenchmarkRolesForPlayer(guild, discordId, newSteamId).catch(e => console.error("Benchmark role sync failed:", e?.message));
      } catch {}
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3B82F6)
          .setTitle("Player Updated")
          .setDescription(`Successfully updated **${updated.discordUsername}**'s Steam ID.`)
          .addFields(
            { name: "Discord", value: `<@${updated.discordId}>`, inline: true },
            { name: "Steam ID", value: `\`${updated.steamId}\``, inline: true },
            { name: "EXVL Tracker", value: `[**Open Benchmarks**](https://evxl.app/u/${updated.steamId})` },
          )
      ],
      components: [backButton()],
      ephemeral: true,
    });
    return;
  }
}

export async function startBot() {
  if (!DISCORD_BOT_TOKEN) {
    console.error("DISCORD_BOT_TOKEN is not set - bot will not start");
    return;
  }
  if (!DISCORD_APP_ID) {
    console.error("DISCORD_APP_ID is not set - cannot register commands");
    return;
  }
  await registerCommands();
  await client.login(DISCORD_BOT_TOKEN);
}
