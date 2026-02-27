import { pgTable, text, serial, timestamp, integer, real, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  steamId: text("steam_id").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const activitySnapshots = pgTable("activity_snapshots", {
  id: serial("id").primaryKey(),
  steamId: text("steam_id").notNull(),
  kovaaksMinutes2w: integer("kovaaks_minutes_2w").default(0),
  benchmarkEnergies: jsonb("benchmark_energies").$type<Record<string, number>>().default({}),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
}, (table) => [
  index("idx_activity_snapshots_steam_id_snapshot_at").on(table.steamId, table.snapshotAt),
]);

export const scenarioPbs = pgTable("scenario_pbs", {
  id: serial("id").primaryKey(),
  steamId: text("steam_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  bestScore: real("best_score").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_scenario_pbs_steam_id_scenario_name").on(table.steamId, table.scenarioName),
]);

export const insertPlayerSchema = createInsertSchema(players).omit({
  id: true,
  updatedAt: true,
});

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type ActivitySnapshot = typeof activitySnapshots.$inferSelect;
export type CreatePlayerRequest = InsertPlayer;
export type UpdatePlayerRequest = Omit<Partial<InsertPlayer>, "discordId">;
export type PlayerResponse = Player;
export type PlayersListResponse = Player[];
