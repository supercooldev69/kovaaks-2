const STEAM_API_KEY = process.env.STEAM_API_KEY;
if (!STEAM_API_KEY) {
  throw new Error("STEAM_API_KEY must be set.");
}
const KOVAAKS_APP_ID = 824270;
const ARK_SE_APP_ID = 346110;
const ARK_SA_APP_ID = 2399830;

export { KOVAAKS_APP_ID, ARK_SE_APP_ID, ARK_SA_APP_ID };

export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number;
  gameid?: string;
  gameextrainfo?: string;
  loccountrycode?: string;
  timecreated?: number;
}

export interface ExvlBenchmarkEntry {
  steamId: string;
  benchmarkId: number;
  difficultyName: string;
  rank: number;
  rankName: string;
  position: number;
  benchmarkName: string;
  energy: number;
  progress: number;
  avgScenarioRank: number;
  avgCm360: number;
  lastEpoch: number;
  steamAccountName: string;
  webappUsername: string | null;
  country: string;
  previousRank: number;
  rankDelta: number;
}

export interface ExvlLeaderboardResponse {
  total: number;
  page: number;
  max: number;
  data: ExvlBenchmarkEntry[];
}

export interface KovaaksPlayer {
  steamId: string;
  username: string;
  steamAccountName: string;
  steamAccountAvatar: string;
  country: string;
  kovaaksPlusActive: boolean;
}

export async function getSteamPlayerSummaries(steamIds: string[]): Promise<SteamPlayerSummary[]> {
  if (steamIds.length === 0) return [];

  const batches: SteamPlayerSummary[] = [];
  for (let i = 0; i < steamIds.length; i += 100) {
    const batch = steamIds.slice(i, i + 100);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?steamids=${batch.join(",")}&key=${STEAM_API_KEY}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json() as any;
      batches.push(...(data?.response?.players || []));
    } catch {
      continue;
    }
  }
  return batches;
}

export const TRACKED_BENCHMARKS = [
  { id: 686, name: "Viscose Easy" },
  { id: 687, name: "Viscose Medium" },
  { id: 688, name: "Viscose Hard" },
  { id: 459, name: "Voltaic S5 Novice" },
  { id: 458, name: "Voltaic S5 Intermediate" },
  { id: 460, name: "Voltaic S5 Advanced" },
  { id: 988, name: "JP Ground Fundamentals" },
  { id: 962, name: "JP Ground Easy" },
  { id: 959, name: "JP Ground Hard" },
];

export async function getExvlBenchmark(steamId: string, benchmarkId: number = 687): Promise<ExvlBenchmarkEntry | null> {
  try {
    const url = `https://api.evxl.app/leaderboard?benchmarkId=${benchmarkId}&steamIdSearch=${steamId}&max=1`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`[EXVL] API returned ${res.status} for steamId=${steamId} benchmark=${benchmarkId}`);
      return null;
    }
    const data = await res.json() as ExvlLeaderboardResponse;
    return data.data.length > 0 ? data.data[0] : null;
  } catch (e: any) {
    console.log(`[EXVL] API error for steamId=${steamId} benchmark=${benchmarkId}: ${e?.message}`);
    return null;
  }
}

export async function getPlayerAllBenchmarks(steamId: string): Promise<ExvlBenchmarkEntry[]> {
  const results = await Promise.all(
    TRACKED_BENCHMARKS.map(b => getExvlBenchmark(steamId, b.id))
  );
  return results.filter((r): r is ExvlBenchmarkEntry => r !== null);
}

export async function getExvlLeaderboard(benchmarkId: number = 535, page: number = 0, max: number = 50): Promise<ExvlLeaderboardResponse | null> {
  try {
    const url = `https://api.evxl.app/leaderboard?benchmarkId=${benchmarkId}&page=${page}&max=${max}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as ExvlLeaderboardResponse;
  } catch {
    return null;
  }
}

export async function searchKovaaksPlayer(username: string): Promise<KovaaksPlayer[]> {
  try {
    const url = `https://kovaaks.com/webapp-backend/user/search?username=${encodeURIComponent(username)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json() as KovaaksPlayer[];
  } catch {
    return [];
  }
}

export async function getKovaaksPlayerBySteamId(steamId: string): Promise<KovaaksPlayer | null> {
  try {
    const summaries = await getSteamPlayerSummaries([steamId]);
    if (summaries.length === 0) return null;
    const name = summaries[0].personaname;
    const results = await searchKovaaksPlayer(name);
    return results.find(p => p.steamId === steamId) || null;
  } catch {
    return null;
  }
}

export async function getKovaaksPlaytime(steamId: string): Promise<number | null> {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json&key=${STEAM_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const games = data?.response?.games;
    if (!games) return null;
    const kovaaks = games.find((g: any) => g.appid === KOVAAKS_APP_ID);
    return kovaaks ? kovaaks.playtime_forever : null;
  } catch {
    return null;
  }
}

export interface SteamRecentGame {
  appid: number;
  name: string;
  playtime_2weeks: number;
  playtime_forever: number;
}

export async function getRecentlyPlayedGames(steamId: string): Promise<SteamRecentGame[]> {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?steamid=${steamId}&format=json&key=${STEAM_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.response?.games || [];
  } catch {
    return [];
  }
}

export async function getKovaaksRecentPlaytime(steamId: string): Promise<number> {
  const games = await getRecentlyPlayedGames(steamId);
  const kovaaks = games.find(g => g.appid === KOVAAKS_APP_ID);
  return kovaaks ? kovaaks.playtime_2weeks : 0;
}

export function countryCodeToFlag(code: string | undefined): string {
  if (!code || code.length !== 2) return "\u{1F30D}";
  const upper = code.toUpperCase();
  const chars = upper.split("").map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
  return chars.join("");
}

export function personaStateToString(state: number): string {
  switch (state) {
    case 0: return "Offline";
    case 1: return "Online";
    case 2: return "Busy";
    case 3: return "Away";
    case 4: return "Snooze";
    case 5: return "Looking to trade";
    case 6: return "Looking to play";
    default: return "Unknown";
  }
}

export function isPlayingTrackedGame(player: SteamPlayerSummary): { playing: boolean; gameName: string } {
  if (!player.gameid) return { playing: false, gameName: "" };
  const appId = parseInt(player.gameid);
  if (appId === KOVAAKS_APP_ID || appId === ARK_SE_APP_ID || appId === ARK_SA_APP_ID) {
    return { playing: true, gameName: player.gameextrainfo || "Unknown Game" };
  }
  return { playing: false, gameName: "" };
}

export const VISCOSE_EASY_RANKS = ["Lemming", "Hare", "Ermine", "Penguin", "Fox", "Mammoth", "Orca", "Seal"];
export const VISCOSE_MEDIUM_RANKS = ["Cinnabar", "Vermillion", "Saffron", "Celadon", "Cerulean", "Lavender", "Indigo", "Fuchsia"];
export const VISCOSE_HARD_RANKS = ["Wool", "Linen", "Velvet", "Chiffon", "Satin", "Silk"];

export const VOLTAIC_NOV_RANKS = ["Iron", "Bronze", "Silver", "Gold"];
export const VOLTAIC_INT_RANKS = ["Platinum", "Diamond", "Jade", "Master"];
export const VOLTAIC_ADV_RANKS = ["Grandmaster", "Nova", "Astra", "Celestial"];

export const JP_FUNDAMENTALS_RANKS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Jade", "Master"];
export const JP_EASY_RANKS = ["Diamond", "Jade", "Master", "Grandmaster", "Nova"];
export const JP_HARD_RANKS = ["Grandmaster", "Nova", "Astra", "Celestial", "Transcendent"];

export const ALL_VISCOSE_RANKS = Array.from(new Set([...VISCOSE_EASY_RANKS, ...VISCOSE_MEDIUM_RANKS, ...VISCOSE_HARD_RANKS]));
export const ALL_VOLTAIC_RANKS = Array.from(new Set([...VOLTAIC_NOV_RANKS, ...VOLTAIC_INT_RANKS, ...VOLTAIC_ADV_RANKS]));
export const ALL_JP_RANKS = Array.from(new Set([...JP_FUNDAMENTALS_RANKS, ...JP_EASY_RANKS, ...JP_HARD_RANKS]));
export const ALL_BENCHMARK_RANKS = Array.from(new Set([...ALL_VISCOSE_RANKS, ...ALL_VOLTAIC_RANKS, ...ALL_JP_RANKS]));

export const BENCHMARK_RANK_MAP: Record<number, string[]> = {
  686: VISCOSE_EASY_RANKS,
  687: VISCOSE_MEDIUM_RANKS,
  688: VISCOSE_HARD_RANKS,
  459: VOLTAIC_NOV_RANKS,
  458: VOLTAIC_INT_RANKS,
  460: VOLTAIC_ADV_RANKS,
  988: JP_FUNDAMENTALS_RANKS,
  962: JP_EASY_RANKS,
  959: JP_HARD_RANKS,
};

export interface BenchmarkScenarioConfig {
  benchmarkId: number;
  ranks: string[];
}

export const BENCHMARK_SCENARIO_CONFIGS: Record<number, BenchmarkScenarioConfig> = {
  458: { benchmarkId: 458, ranks: ["Platinum", "Diamond", "Jade", "Master"] },
  459: { benchmarkId: 459, ranks: ["Iron", "Bronze", "Silver", "Gold"] },
  460: { benchmarkId: 460, ranks: ["Grandmaster", "Nova", "Astra", "Celestial"] },
  686: { benchmarkId: 686, ranks: ["Lemming", "Hare", "Ermine", "Penguin", "Fox", "Mammoth", "Orca", "Seal"] },
  687: { benchmarkId: 687, ranks: ["Cinnabar", "Vermillion", "Saffron", "Celadon", "Cerulean", "Lavender", "Indigo", "Fuchsia"] },
  688: { benchmarkId: 688, ranks: ["Wool", "Linen", "Velvet", "Chiffon", "Satin", "Silk"] },
  988: { benchmarkId: 988, ranks: JP_FUNDAMENTALS_RANKS },
  962: { benchmarkId: 962, ranks: JP_EASY_RANKS },
  959: { benchmarkId: 959, ranks: JP_HARD_RANKS },
};

export const JP_BENCHMARK_IDS = new Set([988, 962, 959]);
export const JP_ROLE_BENCHMARK_IDS = new Set([962, 959]);

export const JP_BENCHMARK_PREFIX: Record<number, string> = {
  962: "JP Easy",
  959: "JP Hard",
};

interface KovaaksBenchmarkProgress {
  benchmark_progress: number;
  overall_rank: number;
  categories: Record<string, {
    benchmark_progress: number;
    category_rank: number;
    rank_maxes: number[];
    scenarios: Record<string, {
      score: number;
      leaderboard_rank: number;
      scenario_rank: number;
      rank_maxes: number[];
      leaderboard_id: number;
    }>;
  }>;
}

export async function getKovaaksBenchmarkProgress(steamId: string, benchmarkId: number): Promise<KovaaksBenchmarkProgress | null> {
  const url = `https://kovaaks.com/webapp-backend/benchmarks/player-progress-rank-benchmark?benchmarkId=${benchmarkId}&steamId=${steamId}`;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 503 || res.status === 429) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`[KovaaKs] Benchmark progress API returned ${res.status} for steamId=${steamId} benchmark=${benchmarkId}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) {
        console.log(`[KovaaKs] Benchmark progress API returned ${res.status} for steamId=${steamId} benchmark=${benchmarkId}`);
        return null;
      }
      return await res.json() as KovaaksBenchmarkProgress;
    } catch (e: any) {
      if (attempt < maxRetries - 1) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`[KovaaKs] Benchmark progress API error for steamId=${steamId} benchmark=${benchmarkId}: ${e?.message}, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.log(`[KovaaKs] Benchmark progress API error for steamId=${steamId} benchmark=${benchmarkId}: ${e?.message} (all retries exhausted)`);
      return null;
    }
  }
  return null;
}

const VISCOSE_TRACKING_CATEGORIES = new Set([
  "arm", "wrist", "fingertip", "blending",
  "control", "speed track", "reading track",
]);

export function getScenarioRankFromProgress(
  progress: KovaaksBenchmarkProgress,
  ranks: string[],
): { trackingRank: string | null; isAllCategoriesComplete: boolean; completeRank: string | null; categoryDetails: { category: string; rank: number; maxRank: number }[] } {
  const categoryDetails: { category: string; rank: number; maxRank: number }[] = [];
  let minAllScenarioRank = Infinity;
  const trackingScenarioRanks: number[] = [];

  for (const [catName, cat] of Object.entries(progress.categories)) {
    categoryDetails.push({ category: catName, rank: cat.category_rank, maxRank: cat.rank_maxes.length });
    const lower = catName.toLowerCase();
    const isTracking = lower === "tracking" || VISCOSE_TRACKING_CATEGORIES.has(lower);

    if (cat.scenarios) {
      for (const [, scen] of Object.entries(cat.scenarios)) {
        if (scen.scenario_rank < minAllScenarioRank) minAllScenarioRank = scen.scenario_rank;
        if (isTracking) {
          trackingScenarioRanks.push(scen.scenario_rank);
        }
      }
    } else {
      if (isTracking) {
        trackingScenarioRanks.push(cat.category_rank);
      }
      if (cat.category_rank < minAllScenarioRank) minAllScenarioRank = cat.category_rank;
    }
  }

  let trackingRankNum = 0;
  if (trackingScenarioRanks.length > 0) {
    trackingRankNum = Math.min(...trackingScenarioRanks);
  }

  if (trackingRankNum <= 0 && trackingScenarioRanks.length === 0) {
    const allRanks: number[] = [];
    for (const cat of Object.values(progress.categories)) {
      if (cat.scenarios) {
        for (const scen of Object.values(cat.scenarios)) {
          if (scen.scenario_rank > 0) allRanks.push(scen.scenario_rank);
        }
      } else if (cat.category_rank > 0) {
        allRanks.push(cat.category_rank);
      }
    }
    if (allRanks.length > 0) {
      trackingRankNum = Math.max(...allRanks);
    }
  }

  if (trackingRankNum <= 0) {
    return { trackingRank: null, isAllCategoriesComplete: false, completeRank: null, categoryDetails };
  }

  const trackingIdx = Math.min(trackingRankNum, ranks.length) - 1;
  const trackingRank = ranks[trackingIdx] || null;

  const allComplete = minAllScenarioRank > 0 && minAllScenarioRank !== Infinity;
  const completeIdx = allComplete ? Math.min(minAllScenarioRank, ranks.length) - 1 : -1;
  const isAllCategoriesComplete = allComplete && completeIdx >= trackingIdx;
  const completeRank = allComplete ? (ranks[completeIdx] || null) : null;

  return { trackingRank, isAllCategoriesComplete, completeRank, categoryDetails };
}

export function getAvgLeaderboardRank(progress: KovaaksBenchmarkProgress): number | null {
  const ranks: number[] = [];
  for (const cat of Object.values(progress.categories)) {
    if (cat.scenarios) {
      for (const scen of Object.values(cat.scenarios)) {
        if (scen.leaderboard_rank > 0) ranks.push(scen.leaderboard_rank);
      }
    }
  }
  if (ranks.length === 0) return null;
  return Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length);
}

export async function getKovaaksUsername(steamId: string): Promise<string | null> {
  const benchmarks = await getPlayerAllBenchmarks(steamId);
  for (const b of benchmarks) {
    if (b.webappUsername) return b.webappUsername;
  }
  try {
    const summaries = await getSteamPlayerSummaries([steamId]);
    if (summaries.length === 0) return null;
    const name = summaries[0].personaname;
    const results = await searchKovaaksPlayer(name);
    const match = results.find(p => p.steamId === steamId);
    return match ? match.username : null;
  } catch {
    return null;
  }
}

export async function getTrackingRankFromScenarios(
  steamId: string,
  config: BenchmarkScenarioConfig,
): Promise<{ trackingRank: string | null; isAllComplete: boolean; completeRank: string | null }> {
  const progress = await getKovaaksBenchmarkProgress(steamId, config.benchmarkId);
  if (!progress) return { trackingRank: null, isAllComplete: false, completeRank: null };
  const result = getScenarioRankFromProgress(progress, config.ranks);
  return { trackingRank: result.trackingRank, isAllComplete: result.isAllCategoriesComplete, completeRank: result.completeRank };
}

export async function getTrackingRolesForPlayer(
  steamId: string,
  benchmarks: ExvlBenchmarkEntry[],
): Promise<{ desiredRoles: string[] }> {
  const processedBenchmarkIds = new Set<number>();
  const rolesPerBenchmark = new Map<number, { rank: string; isComplete: boolean }[]>();

  // Fetch all scenario tracking results in parallel for benchmarks with EXVL data
  const benchmarksWithRanks = benchmarks.filter(b => BENCHMARK_RANK_MAP[b.benchmarkId]);
  for (const b of benchmarks) {
    processedBenchmarkIds.add(b.benchmarkId);
  }

  const scenarioResults = await Promise.all(
    benchmarksWithRanks.map(async (b) => {
      const config = BENCHMARK_SCENARIO_CONFIGS[b.benchmarkId];
      const result = config ? await getTrackingRankFromScenarios(steamId, config) : null;
      return { benchmark: b, result };
    })
  );

  for (const { benchmark: b, result: scenarioResult } of scenarioResults) {
    const benchRanks = BENCHMARK_RANK_MAP[b.benchmarkId]!;

    const isUnranked = b.rankName === "Unranked" || !b.rankName;
    let energyBaseRank: string | null = null;
    if (!isUnranked) {
      let rn = b.rankName;
      rn = rn.replace(/ Tracking$/, "").replace(/ Complete$/, "");
      const matchedRank = benchRanks.find(r => r.toLowerCase() === rn.toLowerCase());
      energyBaseRank = matchedRank || null;
    }

    const progressPct = b.progress <= 1 ? b.progress * 100 : b.progress;
    const energyComplete = energyBaseRank !== null && progressPct >= 100;

    const scenarioTrackingRank = scenarioResult?.trackingRank ?? null;
    const scenarioAllComplete = scenarioResult?.isAllComplete ?? false;
    const scenarioCompleteRank = scenarioResult?.completeRank ?? null;

    const isJP = JP_BENCHMARK_IDS.has(b.benchmarkId);
    if (isJP) {
      if (!JP_ROLE_BENCHMARK_IDS.has(b.benchmarkId)) {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${b.benchmarkId}: Fundamentals — skipping role assignment`);
        continue;
      }
      if (scenarioCompleteRank) {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${b.benchmarkId}: all scenarios complete at ${scenarioCompleteRank}`);
        rolesPerBenchmark.set(b.benchmarkId, [{ rank: scenarioCompleteRank, isComplete: true }]);
      } else {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${b.benchmarkId}: not all scenarios at same rank (complete-only, no tracking variant)`);
      }
    } else {
      const energyIdx = energyBaseRank ? benchRanks.indexOf(energyBaseRank) : -1;
      const scenarioIdx = scenarioTrackingRank ? benchRanks.indexOf(scenarioTrackingRank) : -1;
      const bestIdx = Math.max(energyIdx, scenarioIdx);
      const bestRank = bestIdx >= 0 ? benchRanks[bestIdx] : null;

      if (bestRank) {
        const benchmarkRoles: { rank: string; isComplete: boolean }[] = [];
        const isComplete = scenarioAllComplete || (energyComplete && energyIdx >= bestIdx);

        if (scenarioTrackingRank && scenarioIdx > energyIdx) {
          console.log(`[TrackingRole] ${steamId} benchmark ${b.benchmarkId}: scenario tracking rank ${scenarioTrackingRank} > energy rank ${energyBaseRank ?? "Unranked"}, using ${bestRank} (${isComplete ? "Complete" : "Tracking"})`);
        } else if (scenarioTrackingRank && energyBaseRank) {
          console.log(`[TrackingRole] ${steamId} benchmark ${b.benchmarkId}: energy rank ${energyBaseRank} (${progressPct.toFixed(1)}%) >= scenario tracking rank ${scenarioTrackingRank}, using ${bestRank} (${isComplete ? "Complete" : "Tracking"})`);
        } else if (energyBaseRank) {
          console.log(`[TrackingRole] ${steamId} benchmark ${b.benchmarkId}: energy rank ${energyBaseRank} (${progressPct.toFixed(1)}%), using ${bestRank} (${isComplete ? "Complete" : "Tracking"})`);
        }

        benchmarkRoles.push({ rank: bestRank, isComplete });

        if (!isComplete && scenarioCompleteRank && scenarioCompleteRank !== bestRank) {
          const completeIdx = benchRanks.indexOf(scenarioCompleteRank);
          if (completeIdx >= 0 && completeIdx < bestIdx) {
            console.log(`[TrackingRole] ${steamId} benchmark ${b.benchmarkId}: also awarding ${scenarioCompleteRank} Complete (all categories at this rank)`);
            benchmarkRoles.push({ rank: scenarioCompleteRank, isComplete: true });
          }
        }

        if (!isComplete && energyComplete && energyBaseRank && energyBaseRank !== bestRank) {
          const alreadyHasComplete = benchmarkRoles.some(r => r.isComplete);
          const energyCompleteIdx = benchRanks.indexOf(energyBaseRank);
          if (!alreadyHasComplete && energyCompleteIdx >= 0 && energyCompleteIdx < bestIdx) {
            console.log(`[TrackingRole] ${steamId} benchmark ${b.benchmarkId}: also awarding ${energyBaseRank} Complete (energy 100%)`);
            benchmarkRoles.push({ rank: energyBaseRank, isComplete: true });
          }
        }

        rolesPerBenchmark.set(b.benchmarkId, benchmarkRoles);
      }
    }
  }

  // Fetch remaining benchmarks (not in EXVL data) in parallel
  const remainingBenchmarks = Object.entries(BENCHMARK_SCENARIO_CONFIGS)
    .filter(([benchIdStr]) => !processedBenchmarkIds.has(parseInt(benchIdStr)))
    .filter(([benchIdStr]) => BENCHMARK_RANK_MAP[parseInt(benchIdStr)]);

  const remainingResults = await Promise.all(
    remainingBenchmarks.map(async ([benchIdStr, config]) => {
      const benchId = parseInt(benchIdStr);
      const result = await getTrackingRankFromScenarios(steamId, config);
      return { benchId, config, result };
    })
  );

  for (const { benchId, result } of remainingResults) {
    const benchRanks = BENCHMARK_RANK_MAP[benchId]!;
    const isJPBench = JP_BENCHMARK_IDS.has(benchId);

    if (isJPBench) {
      if (!JP_ROLE_BENCHMARK_IDS.has(benchId)) {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${benchId}: Fundamentals — skipping role assignment`);
        continue;
      }
      if (result.completeRank) {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${benchId}: no EXVL entry, all scenarios complete at ${result.completeRank}`);
        rolesPerBenchmark.set(benchId, [{ rank: result.completeRank, isComplete: true }]);
      } else {
        console.log(`[TrackingRole] ${steamId} JP benchmark ${benchId}: no EXVL entry, not all scenarios at same rank (complete-only)`);
      }
    } else if (result.trackingRank) {
      const benchmarkRoles: { rank: string; isComplete: boolean }[] = [];
      const suffix = result.isAllComplete ? "Complete" : "Tracking";
      console.log(`[TrackingRole] ${steamId} benchmark ${benchId}: no EXVL entry, scenario tracking rank ${result.trackingRank} (${suffix} via scenarios)`);
      benchmarkRoles.push({ rank: result.trackingRank, isComplete: result.isAllComplete });

      if (!result.isAllComplete && result.completeRank && result.completeRank !== result.trackingRank) {
        const completeIdx = benchRanks.indexOf(result.completeRank);
        const trackingIdx = benchRanks.indexOf(result.trackingRank);
        if (completeIdx >= 0 && completeIdx < trackingIdx) {
          console.log(`[TrackingRole] ${steamId} benchmark ${benchId}: also awarding ${result.completeRank} Complete (all categories at this rank, via scenarios)`);
          benchmarkRoles.push({ rank: result.completeRank, isComplete: true });
        }
      }

      rolesPerBenchmark.set(benchId, benchmarkRoles);
    } else {
      console.log(`[TrackingRole] ${steamId} benchmark ${benchId}: no EXVL entry, no scenario rank found`);
    }
  }

  const desiredRoles: string[] = [];
  for (const [benchId, roles] of Array.from(rolesPerBenchmark.entries())) {
    const isJP = JP_BENCHMARK_IDS.has(benchId);
    const jpPrefix = isJP ? JP_BENCHMARK_PREFIX[benchId] : null;

    for (const { rank, isComplete } of roles) {
      const prefix = jpPrefix ? `${jpPrefix} ` : "";
      desiredRoles.push(`${prefix}${rank} ${isComplete ? "Complete" : "Tracking"}`);
    }
  }

  return { desiredRoles };
}

export const RANK_COLORS: Record<string, number> = {
  "Lemming": 0x7BA5A5,
  "Hare": 0x6B9B9B,
  "Ermine": 0x5A8F8F,
  "Penguin": 0x4A7F7F,
  "Fox": 0x3D7272,
  "Mammoth": 0x336666,
  "Orca": 0x2A5656,
  "Seal": 0xFFB6C1,
  "Cinnabar": 0xE44D2E,
  "Vermillion": 0xE34234,
  "Saffron": 0xF4C430,
  "Celadon": 0xACE1AF,
  "Cerulean": 0x007BA7,
  "Lavender": 0xB57EDC,
  "Indigo": 0x4B0082,
  "Fuchsia": 0xFF00FF,
  "Wool": 0xB0A090,
  "Linen": 0xFAF0E6,
  "Velvet": 0x750851,
  "Chiffon": 0xFFFDD0,
  "Satin": 0xCBA135,
  "Silk": 0xFFC0CB,
  "Iron": 0xA5A5A5,
  "Bronze": 0xD17507,
  "Silver": 0xCBD9E6,
  "Gold": 0xD8BF52,
  "Platinum": 0x2FCFC2,
  "Diamond": 0xB9F2FF,
  "Jade": 0x62D362,
  "Master": 0xDD52D6,
  "Grandmaster": 0xFFD700,
  "Nova": 0xAB7EF2,
  "Astra": 0xE51565,
  "Celestial": 0x24DDD8,
  "Transcendent": 0xFFFFFF,
};

export const TRACKING_ROLE_COLORS: Record<string, number> = {};
for (const [rank, color] of Object.entries(RANK_COLORS)) {
  TRACKING_ROLE_COLORS[`${rank} Complete`] = color;
  TRACKING_ROLE_COLORS[`${rank} Tracking`] = color;
}
for (const [benchIdStr, prefix] of Object.entries(JP_BENCHMARK_PREFIX)) {
  const ranks = BENCHMARK_RANK_MAP[parseInt(benchIdStr)];
  if (!ranks) continue;
  for (const rank of ranks) {
    const color = RANK_COLORS[rank] ?? 0x000000;
    TRACKING_ROLE_COLORS[`${prefix} ${rank} Complete`] = color;
  }
}

export function getViscoseRolesOrdered(): string[] {
  const hardFirst = [...VISCOSE_HARD_RANKS].reverse();
  const mediumFirst = [...VISCOSE_MEDIUM_RANKS].reverse();
  const easyFirst = [...VISCOSE_EASY_RANKS].reverse();
  const allRanks = [...hardFirst, ...mediumFirst, ...easyFirst];
  const result: string[] = [];
  for (const r of allRanks) {
    result.push(`${r} Complete`);
    result.push(`${r} Tracking`);
  }
  return result;
}

export function getVoltaicRolesOrdered(): string[] {
  const advFirst = [...VOLTAIC_ADV_RANKS].reverse();
  const intFirst = [...VOLTAIC_INT_RANKS].reverse();
  const novFirst = [...VOLTAIC_NOV_RANKS].reverse();
  const allRanks = [...advFirst, ...intFirst, ...novFirst];
  const result: string[] = [];
  for (const r of allRanks) {
    result.push(`${r} Complete`);
    result.push(`${r} Tracking`);
  }
  return result;
}

export function getJPRolesOrdered(): string[] {
  const result: string[] = [];
  const hardReversed = [...JP_HARD_RANKS].reverse();
  for (const r of hardReversed) {
    result.push(`JP Hard ${r} Complete`);
  }
  const easyReversed = [...JP_EASY_RANKS].reverse();
  for (const r of easyReversed) {
    result.push(`JP Easy ${r} Complete`);
  }
  return result;
}

export function getAllTrackingRoleNames(): string[] {
  const roles: string[] = [];
  for (const [idStr, ranks] of Object.entries(BENCHMARK_RANK_MAP)) {
    const benchId = parseInt(idStr);
    const isJP = JP_BENCHMARK_IDS.has(benchId);
    if (isJP && !JP_ROLE_BENCHMARK_IDS.has(benchId)) continue;
    const prefix = isJP ? `${JP_BENCHMARK_PREFIX[benchId]} ` : "";
    for (const rank of ranks) {
      const completeName = `${prefix}${rank} Complete`;
      if (!roles.includes(completeName)) roles.push(completeName);
      if (!isJP) {
        const trackingName = `${prefix}${rank} Tracking`;
        if (!roles.includes(trackingName)) roles.push(trackingName);
      }
    }
  }
  return roles;
}

export function getRolesForBenchmarkId(benchmarkId: number): string[] {
  const ranks = BENCHMARK_RANK_MAP[benchmarkId];
  if (!ranks) return [];
  return ranks.map(r => `${r} Complete`);
}
