import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LocalServerContext } from "./context.ts";
import { createCreateTaskRoutes } from "./create-task/routes.ts";
import { createEventsSSEHandler } from "./events/index.ts";
import { createLogStreamHandler } from "./events/log-routes.ts";
import { createFsRoutes } from "./fs/routes.ts";
import { createRepoRoutes } from "./repo/routes";
import { createRunTaskRoutes } from "./run-task/routes.ts";
import { createSessionRoutes } from "./session/routes.ts";
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

export interface EventsSSEOptions {
  heartbeatIntervalMs?: number;
}

export interface AppDependencies {
  ctx: LocalServerContext;
  startTimeMs: number;
  orchestratorStatus?: () => OrchestratorStatus;
  isReady?: () => boolean;
  triggerRefresh?: () => boolean;
  dashboardStaticPath?: string;
  dashboardDevOrigin?: string;
  eventsSSEOptions?: EventsSSEOptions;
}

export const createApp = (deps: AppDependencies) => {
  const { ctx, dashboardStaticPath, dashboardDevOrigin } = deps;
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: dashboardDevOrigin ?? "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Length"],
      credentials: true,
    }),
  );

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

  app.get("/api/events", createEventsSSEHandler(ctx, deps.eventsSSEOptions));
  app.get("/api/executions/:executionId/logs", createLogStreamHandler(ctx));

  app.get("/api/metrics", async (c) => {
    const repoId = c.req.query("repoId");
    const metrics = await ctx.taskRepository.getMetrics(repoId);
    return c.json(metrics);
  });

  app.route("/api/repos", createRepoRoutes(ctx));
  app.route("/api/sessions", createSessionRoutes(ctx));
  app.route("/api/settings", createSettingsRoutes(ctx));
  app.route("/api/create-task", createCreateTaskRoutes(ctx));
  app.route("/api/run-task", createRunTaskRoutes(ctx));
  app.route("/api/fs", createFsRoutes());

  // Test-only endpoint to directly set task status (for E2E testing)
  if (process.env.AOP_TEST_MODE === "true") {
    app.patch("/api/tasks/:taskId/status", async (c) => {
      const taskId = c.req.param("taskId");
      const body = await c.req.json<{ status: string }>();

      const validStatuses = ["DRAFT", "READY", "WORKING", "BLOCKED", "DONE", "REMOVED"];
      if (!validStatuses.includes(body.status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const task = await ctx.taskRepository.get(taskId);
      if (!task) {
        return c.json({ error: "Task not found" }, 404);
      }

      const updated = await ctx.taskRepository.update(taskId, {
        status: body.status as "DRAFT" | "READY" | "WORKING" | "BLOCKED" | "DONE" | "REMOVED",
      });

      return c.json({ ok: true, task: updated });
    });
  }

  if (dashboardStaticPath) {
    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith("/api/")) {
        return c.notFound();
      }

      const staticResponse = await serveStaticFile(dashboardStaticPath, pathname);
      if (staticResponse) return staticResponse;

      const spaResponse = await serveSpaFallback(dashboardStaticPath);
      if (spaResponse) return spaResponse;

      return c.notFound();
    });
  }

  return app;
};

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

const getMimeType = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase();
  return MIME_TYPES[ext ?? ""] ?? "application/octet-stream";
};

const serveStaticFile = async (basePath: string, pathname: string): Promise<Response | null> => {
  const filePath = pathname === "/" ? `${basePath}/index.html` : `${basePath}${pathname}`;

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  }
  return null;
};

const serveSpaFallback = async (basePath: string): Promise<Response | null> => {
  const indexFile = Bun.file(`${basePath}/index.html`);
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html" },
    });
  }
  return null;
};
