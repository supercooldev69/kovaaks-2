import type { Express } from "express";
import type { Server } from "http";
import { startBot } from "./bot";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  startBot().catch(err => {
    console.error("Failed to start Discord bot:", err);
  });

  return httpServer;
}
