import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type AppDependencies, createApp } from "./app.ts";
import { type CommandContext, createCommandContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "./db/test-utils.ts";

describe("app", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let deps: AppDependencies;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    deps = {
      ctx,
      startTimeMs: Date.now() - 5000,
      orchestratorStatus: () => ({
        watcher: "running",
        ticker: "running",
        processor: "running",
      }),
      isReady: () => true,
      triggerRefresh: () => true,
    };
    app = createApp(deps);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/health", () => {
    test("returns health status with all components", async () => {
      const res = await app.request("/api/health");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.db.connected).toBe(true);
      expect(body.orchestrator).toEqual({
        watcher: "running",
        ticker: "running",
        processor: "running",
      });
    });

    test("returns default orchestrator status when not provided", async () => {
      const appWithoutOrchestrator = createApp({
        ctx,
        startTimeMs: Date.now(),
      });

      const res = await appWithoutOrchestrator.request("/api/health");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.orchestrator).toEqual({
        watcher: "stopped",
        ticker: "stopped",
        processor: "stopped",
      });
    });
  });

  describe("GET /api/status", () => {
    test("returns empty status when no repos", async () => {
      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.globalCapacity.working).toBe(0);
      expect(body.repos).toEqual([]);
    });

    test("returns repos with their tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1", { maxConcurrentTasks: 2 });
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0].id).toBe("repo-1");
      expect(body.repos[0].path).toBe("/path/to/repo1");
      expect(body.repos[0].max).toBe(2);
      expect(body.repos[0].tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks from repo tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(body.repos[0].tasks).toHaveLength(1);
      expect(body.repos[0].tasks[0].id).toBe("task-1");
    });

    test("returns ready=false when orchestrator not ready", async () => {
      const appNotReady = createApp({
        ctx,
        startTimeMs: Date.now(),
        isReady: () => false,
      });

      const res = await appNotReady.request("/api/status");
      const body: AnyJson = await res.json();

      expect(body.ready).toBe(false);
    });
  });

  describe("POST /api/refresh", () => {
    test("triggers refresh successfully", async () => {
      const res = await app.request("/api/refresh", { method: "POST" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.message).toBe("Refresh triggered");
    });

    test("returns 503 when orchestrator not ready", async () => {
      const appNotReady = createApp({
        ctx,
        startTimeMs: Date.now(),
        triggerRefresh: () => false,
      });

      const res = await appNotReady.request("/api/refresh", { method: "POST" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toBe("Orchestrator not ready");
    });

    test("returns 503 when triggerRefresh not provided", async () => {
      const appNoRefresh = createApp({
        ctx,
        startTimeMs: Date.now(),
      });

      const res = await appNoRefresh.request("/api/refresh", { method: "POST" });

      expect(res.status).toBe(503);
    });
  });
});
