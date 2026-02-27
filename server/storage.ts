import { db } from "./db";
import {
  players,
  activitySnapshots,
  scenarioPbs,
  type CreatePlayerRequest,
  type UpdatePlayerRequest,
  type PlayerResponse,
  type ActivitySnapshot,
} from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export interface IStorage {
  getPlayers(): Promise<PlayerResponse[]>;
  getPlayerByDiscordId(discordId: string): Promise<PlayerResponse | undefined>;
  createPlayer(player: CreatePlayerRequest): Promise<PlayerResponse>;
  updatePlayer(id: number, updates: UpdatePlayerRequest): Promise<PlayerResponse>;
  deletePlayer(id: number): Promise<void>;
  saveActivitySnapshot(steamId: string, kovaaksMinutes2w: number, benchmarkEnergies: Record<string, number>): Promise<void>;
  getLatestSnapshot(steamId: string): Promise<ActivitySnapshot | undefined>;
  getSnapshotsSince(steamId: string, since: Date): Promise<ActivitySnapshot[]>;
  getAllLatestSnapshots(): Promise<ActivitySnapshot[]>;
  getScenarioPb(steamId: string, scenarioName: string): Promise<number | null>;
  upsertScenarioPb(steamId: string, scenarioName: string, score: number): Promise<void>;
  getScenarioPbs(steamId: string): Promise<Record<string, number>>;
}

export class DatabaseStorage implements IStorage {
  async getPlayers(): Promise<PlayerResponse[]> {
    return await db.select().from(players).orderBy(desc(players.updatedAt));
  }

  async getPlayerByDiscordId(discordId: string): Promise<PlayerResponse | undefined> {
    const [player] = await db.select().from(players).where(eq(players.discordId, discordId));
    return player;
  }

  async createPlayer(player: CreatePlayerRequest): Promise<PlayerResponse> {
    const [newPlayer] = await db.insert(players).values(player).returning();
    return newPlayer;
  }

  async updatePlayer(id: number, updates: UpdatePlayerRequest): Promise<PlayerResponse> {
    const [updated] = await db.update(players)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    if (!updated) {
      throw new Error(`Player with id ${id} not found`);
    }
    return updated;
  }

  async deletePlayer(id: number): Promise<void> {
    const [player] = await db.select({ steamId: players.steamId }).from(players).where(eq(players.id, id));
    if (player) {
      await db.delete(activitySnapshots).where(eq(activitySnapshots.steamId, player.steamId));
      await db.delete(scenarioPbs).where(eq(scenarioPbs.steamId, player.steamId));
    }
    await db.delete(players).where(eq(players.id, id));
  }

  async saveActivitySnapshot(steamId: string, kovaaksMinutes2w: number, benchmarkEnergies: Record<string, number>): Promise<void> {
    await db.insert(activitySnapshots).values({
      steamId,
      kovaaksMinutes2w,
      benchmarkEnergies,
    });
  }

  async getLatestSnapshot(steamId: string): Promise<ActivitySnapshot | undefined> {
    const [snap] = await db.select().from(activitySnapshots)
      .where(eq(activitySnapshots.steamId, steamId))
      .orderBy(desc(activitySnapshots.snapshotAt))
      .limit(1);
    return snap;
  }

  async getSnapshotsSince(steamId: string, since: Date): Promise<ActivitySnapshot[]> {
    return await db.select().from(activitySnapshots)
      .where(and(
        eq(activitySnapshots.steamId, steamId),
        gte(activitySnapshots.snapshotAt, since),
      ))
      .orderBy(activitySnapshots.snapshotAt);
  }

  async getAllLatestSnapshots(): Promise<ActivitySnapshot[]> {
    return await db.execute(sql`
      SELECT DISTINCT ON (steam_id) *
      FROM activity_snapshots
      ORDER BY steam_id, snapshot_at DESC
    `) as unknown as ActivitySnapshot[];
  }

  async getScenarioPb(steamId: string, scenarioName: string): Promise<number | null> {
    const [row] = await db.select().from(scenarioPbs)
      .where(and(eq(scenarioPbs.steamId, steamId), eq(scenarioPbs.scenarioName, scenarioName)));
    return row ? row.bestScore : null;
  }

  async upsertScenarioPb(steamId: string, scenarioName: string, score: number): Promise<void> {
    await db.insert(scenarioPbs)
      .values({ steamId, scenarioName, bestScore: score })
      .onConflictDoUpdate({
        target: [scenarioPbs.steamId, scenarioPbs.scenarioName],
        set: { bestScore: score, updatedAt: new Date() },
        where: sql`${scenarioPbs.bestScore} < ${score}`,
      });
  }

  async getScenarioPbs(steamId: string): Promise<Record<string, number>> {
    const rows = await db.select().from(scenarioPbs).where(eq(scenarioPbs.steamId, steamId));
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.scenarioName] = row.bestScore;
    }
    return result;
  }
}

export const storage = new DatabaseStorage();
