import { getLogger } from "@aop/infra";
import { createApp } from "./app.ts";
import { DEFAULT_PORT, getDashboardDevOrigin, getDashboardStaticPath } from "./config.ts";
import { createCommandContext } from "./context.ts";
import { createDatabase, getDefaultDbPath } from "./db/connection.ts";
import { runMigrations } from "./db/migrations.ts";
import { createOrchestrator } from "./orchestrator/index.ts";

const logger = getLogger("aop", "local-server");

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  dashboardStaticPath?: string;
}

export interface ServerHandle {
  shutdown: () => Promise<void>;
}

export const startServer = async (options?: ServerOptions): Promise<ServerHandle> => {
  const port = options?.port ?? DEFAULT_PORT;
  const startTimeMs = Date.now();

  const dbPath = options?.dbPath ?? process.env.AOP_DB_PATH ?? getDefaultDbPath();
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
    dashboardStaticPath: options?.dashboardStaticPath ?? getDashboardStaticPath(),
    dashboardDevOrigin: getDashboardDevOrigin(),
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      fetch: app.fetch,
      port,
      hostname: "127.0.0.1",
      idleTimeout: 60, // Support SSE connections with 30s heartbeat
    });
  } catch (err) {
    await db.destroy();
    const message =
      err instanceof Error && err.message.includes("EADDRINUSE")
        ? `Port ${port} is already in use`
        : `Failed to start server: ${err}`;
    throw new Error(message);
  }

  logger.info("Local server listening on http://127.0.0.1:{port}", { port });

  await orchestrator.start();

  return {
    shutdown: async () => {
      logger.info("Shutting down...");
      await orchestrator.stop();
      server.stop();
      await db.destroy();
      logger.info("Shutdown complete");
    },
  };
};
