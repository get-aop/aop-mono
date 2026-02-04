import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type AppDependencies, createApp } from "./app.ts";
import { createCommandContext, type LocalServerContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "./db/test-utils.ts";

describe("app", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
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
      await createTestRepo(db, "repo-1", "/path/to/repo1", {
        maxConcurrentTasks: 2,
      });
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

      const res = await appNoRefresh.request("/api/refresh", {
        method: "POST",
      });

      expect(res.status).toBe(503);
    });
  });

  describe("GET /api/metrics", () => {
    test("returns metrics without repoId filter", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DONE");

      const res = await app.request("/api/metrics");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("byStatus");
    });

    test("returns metrics filtered by repoId", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "DONE");

      const res = await app.request("/api/metrics?repoId=repo-1");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBe(1);
    });
  });
});

describe("app - test mode endpoint", () => {
  const originalTestMode = process.env.AOP_TEST_MODE;

  beforeEach(() => {
    process.env.AOP_TEST_MODE = "true";
  });

  afterEach(() => {
    if (originalTestMode !== undefined) {
      process.env.AOP_TEST_MODE = originalTestMode;
    } else {
      delete process.env.AOP_TEST_MODE;
    }
  });

  test("PATCH /api/tasks/:taskId/status updates task status", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    await createTestRepo(db, "repo-1", "/path/to/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const res = await app.request("/api/tasks/task-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "READY" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("READY");

    await db.destroy();
  });

  test("PATCH /api/tasks/:taskId/status returns 400 for invalid status", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    await createTestRepo(db, "repo-1", "/path/to/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const res = await app.request("/api/tasks/task-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INVALID" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid status");

    await db.destroy();
  });

  test("PATCH /api/tasks/:taskId/status returns 404 for non-existent task", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    const res = await app.request("/api/tasks/non-existent/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "READY" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Task not found");

    await db.destroy();
  });
});

describe("app - static file serving", () => {
  test("serves static files from dashboardStaticPath", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    // Create a temp dir with test files
    const tempDir = `/tmp/aop-test-static-${Date.now()}`;
    const { mkdirSync, writeFileSync, rmSync, existsSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(`${tempDir}/index.html`, "<html><body>Test</body></html>");
    writeFileSync(`${tempDir}/style.css`, "body { color: red; }");

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    const htmlRes = await app.request("/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("Content-Type")).toBe("text/html");

    const cssRes = await app.request("/style.css");
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("Content-Type")).toBe("text/css");

    // Non-existent file should fall back to SPA
    const spaRes = await app.request("/some/route");
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get("Content-Type")).toBe("text/html");

    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });

  test("returns 404 for /api/* routes when dashboardStaticPath is set", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const tempDir = `/tmp/aop-test-static-api-${Date.now()}`;
    const { mkdirSync, rmSync, existsSync, writeFileSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(`${tempDir}/index.html`, "<html></html>");

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });

  test("returns 404 when index.html does not exist", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const tempDir = `/tmp/aop-test-static-no-index-${Date.now()}`;
    const { mkdirSync, rmSync, existsSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    const res = await app.request("/some/route");
    expect(res.status).toBe(404);

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });
});
