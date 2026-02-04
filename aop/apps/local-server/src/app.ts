import { Hono } from "hono";
import type { CommandContext } from "./context.ts";
import { createRepoRoutes } from "./repo/routes";
import { checkDbConnection } from "./settings/handlers.ts";
import { createSettingsRoutes } from "./settings/routes";
import { getServerStatus } from "./status/handlers.ts";
import { resolveTaskByIdentifier } from "./task/handlers.ts";

export type ServiceStatus = "running" | "stopped";

export interface OrchestratorStatus {
  watcher: ServiceStatus;
  ticker: ServiceStatus;
  processor: ServiceStatus;
}

export interface AppDependencies {
  ctx: CommandContext;
  startTimeMs: number;
  orchestratorStatus?: () => OrchestratorStatus;
  isReady?: () => boolean;
  triggerRefresh?: () => boolean;
}

export const createApp = (deps: AppDependencies) => {
  const { ctx } = deps;
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const { startTimeMs } = deps;
    const uptimeMs = Date.now() - startTimeMs;
    const uptimeSecs = Math.floor(uptimeMs / 1000);

    const dbConnected = await checkDbConnection(ctx);

    return c.json({
      ok: true,
      service: "aop",
      uptime: uptimeSecs,
      db: { connected: dbConnected },
      orchestrator: deps.orchestratorStatus?.() ?? {
        watcher: "stopped",
        ticker: "stopped",
        processor: "stopped",
      },
    });
  });

  app.get("/api/status", async (c) => {
    const status = await getServerStatus(ctx);
    return c.json({
      ready: deps.isReady?.() ?? false,
      ...status,
    });
  });

  app.post("/api/refresh", async (c) => {
    const triggered = deps.triggerRefresh?.() ?? false;
    if (!triggered) {
      return c.json({ error: "Orchestrator not ready" }, 503);
    }
    return c.json({ ok: true, message: "Refresh triggered" });
  });

  app.get("/api/tasks/resolve/:identifier", async (c) => {
    const identifier = c.req.param("identifier");
    const task = await resolveTaskByIdentifier(ctx, identifier);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json({ task });
  });

  app.route("/api/repos", createRepoRoutes(ctx));
  app.route("/api/settings", createSettingsRoutes(ctx));

  return app;
};
