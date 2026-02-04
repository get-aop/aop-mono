#!/usr/bin/env bun

import { configureLogging, getLogger } from "@aop/infra";
import { createApp } from "./app.ts";
import { getDashboardDevOrigin, getDashboardStaticPath, getPort } from "./config.ts";
import { createCommandContext } from "./context.ts";
import { createDatabase, getDefaultDbPath } from "./db/connection.ts";
import { runMigrations } from "./db/migrations.ts";
import { createOrchestrator } from "./orchestrator/index.ts";

const logger = getLogger("aop", "local-server");

const main = async () => {
  await configureLogging({ level: "info", format: "pretty" });

  const port = getPort();
  const startTimeMs = Date.now();

  const dbPath = process.env.AOP_DB_PATH ?? getDefaultDbPath();
  const db = createDatabase(dbPath);
  await runMigrations(db);
  const ctx = createCommandContext(db);

  const orchestrator = createOrchestrator(ctx);

  const app = createApp({
    ctx,
    startTimeMs,
    orchestratorStatus: () => orchestrator.getStatus(),
    isReady: () => orchestrator.isReady(),
    triggerRefresh: () => orchestrator.triggerRefresh(),
    dashboardStaticPath: getDashboardStaticPath(),
    dashboardDevOrigin: getDashboardDevOrigin(),
  });

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: "127.0.0.1",
    idleTimeout: 60, // Support SSE connections with 30s heartbeat
  });

  logger.info("Local server listening on http://127.0.0.1:{port}", { port });

  await orchestrator.start();

  const shutdown = async () => {
    logger.info("Shutting down...");
    await orchestrator.stop();
    server.stop();
    await db.destroy();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((err) => {
  logger.error("Failed to start local server: {error}", { error: String(err) });
  process.exit(1);
});
