import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import { createApp } from "./app.ts";
import { createCommandContext, type LocalServerContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "./db/test-utils.ts";

const TEST_PORT = 25151;
const TEST_SERVER_URL = `http://localhost:${TEST_PORT}`;

describe("CLI integration tests", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let server: ReturnType<typeof Bun.serve>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-cli-test-"));

    db = await createTestDb();
    ctx = createCommandContext(db);
    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      orchestratorStatus: () => ({
        watcher: "running",
        ticker: "running",
        processor: "running",
      }),
      isReady: () => true,
      triggerRefresh: () => true,
    });

    server = Bun.serve({
      fetch: app.fetch,
      port: TEST_PORT,
      hostname: "127.0.0.1",
    });
  });

  afterAll(async () => {
    server.stop();
    await db.destroy();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("status endpoint", () => {
    test("returns status with empty repos", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/status`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ready).toBe(true);
      expect(body.repos).toEqual([]);
    });

    test("returns repos with tasks", async () => {
      await createTestRepo(db, "status-repo", "/path/to/status-repo", {
        maxConcurrentTasks: 2,
      });
      await createTestTask(db, "status-task-1", "status-repo", "changes/feat-1", "DRAFT");

      const response = await fetch(`${TEST_SERVER_URL}/api/status`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.repos.length).toBeGreaterThanOrEqual(1);
      const repo = body.repos.find((r: { id: string }) => r.id === "status-repo");
      expect(repo).toBeDefined();
      expect(repo.tasks.length).toBe(1);
    });
  });

  describe("settings endpoints", () => {
    test("GET /api/settings returns all settings", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.settings).toBeDefined();
      expect(Array.isArray(body.settings)).toBe(true);
    });

    test("PUT /api/settings/:key updates setting", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "5" }),
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("5");
    });

    test("GET /api/settings/:key returns single setting", async () => {
      await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "3" }),
      });

      const response = await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("3");
    });

    test("PUT /api/settings/:key rejects invalid key", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings/invalid_key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "test" }),
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid key");
    });
  });

  describe("repo endpoints", () => {
    test("DELETE /api/repos/:id removes repo", async () => {
      await createTestRepo(db, "remove-test-repo", "/path/to/remove-test-repo");

      const response = await fetch(`${TEST_SERVER_URL}/api/repos/remove-test-repo`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBe("remove-test-repo");
    });

    test("DELETE /api/repos/:id returns 404 for non-existent repo", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/repos/non-existent`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("DELETE /api/repos/:id returns 409 for repo with working tasks", async () => {
      await createTestRepo(db, "busy-repo", "/path/to/busy-repo");
      await createTestTask(db, "working-task", "busy-repo", "changes/feat", "WORKING");

      const response = await fetch(`${TEST_SERVER_URL}/api/repos/busy-repo`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(response.status).toBe(409);
      expect(body.error).toBe("Cannot remove repo with working tasks");
    });
  });

  describe("task endpoints", () => {
    test("POST /api/repos/:repoId/tasks/:taskId/ready marks task as ready", async () => {
      await createTestRepo(db, "ready-repo", "/path/to/ready-repo");
      await createTestTask(db, "ready-task", "ready-repo", "changes/feat", "DRAFT");

      const changePath = join(aopPaths.repoDir("ready-repo"), "changes/feat");
      mkdirSync(changePath, { recursive: true });
      writeFileSync(join(changePath, "tasks.md"), "# Tasks\n- [ ] Task 1");

      const response = await fetch(
        `${TEST_SERVER_URL}/api/repos/ready-repo/tasks/ready-task/ready`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("ready-task");
    });

    test("POST /api/repos/:repoId/tasks/:taskId/ready returns error for invalid status", async () => {
      await createTestRepo(db, "invalid-repo", "/path/to/invalid-repo");
      await createTestTask(db, "invalid-task", "invalid-repo", "changes/feat", "WORKING");

      const response = await fetch(
        `${TEST_SERVER_URL}/api/repos/invalid-repo/tasks/invalid-task/ready`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(body.error).toBe("Invalid task status");
    });

    test("DELETE /api/repos/:repoId/tasks/:taskId removes task", async () => {
      await createTestRepo(db, "delete-repo", "/path/to/delete-repo");
      await createTestTask(db, "delete-task", "delete-repo", "changes/feat", "DRAFT");

      const response = await fetch(`${TEST_SERVER_URL}/api/repos/delete-repo/tasks/delete-task`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("delete-task");
    });

    test("DELETE /api/repos/:repoId/tasks/:taskId requires force for working tasks", async () => {
      await createTestRepo(db, "force-repo", "/path/to/force-repo");
      await createTestTask(db, "force-task", "force-repo", "changes/feat", "WORKING");

      const response = await fetch(`${TEST_SERVER_URL}/api/repos/force-repo/tasks/force-task`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(body.error).toBe("Task is currently working, use force=true to abort");
    });
  });

  describe("health endpoint", () => {
    test("returns health status", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/health`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.db.connected).toBe(true);
      expect(body.orchestrator.watcher).toBe("running");
    });
  });

  describe("refresh endpoint", () => {
    test("triggers refresh when orchestrator is ready", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/refresh`, {
        method: "POST",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.message).toBe("Refresh triggered");
    });
  });
});
