import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createClientRepository } from "../../clients/client-repository.ts";
import { createClientService } from "../../clients/client-service.ts";
import type { Client, Database } from "../../db/schema.ts";
import {
  cleanupTestDb,
  createSimpleWorkflow,
  createTestClient,
  createTestDb,
} from "../../db/test-utils.ts";
import { createExecutionRepository } from "../../executions/execution-repository.ts";
import { createExecutionService, type ExecutionService } from "../../executions/index.ts";
import { createRepoRepository } from "../../repos/repo-repository.ts";
import { createTaskRepository } from "../../tasks/task-repository.ts";
import { createTaskService, type TaskService } from "../../tasks/task-service.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { AppContext } from "../server.ts";
import { tasks } from "./tasks.ts";

describe("tasks routes", () => {
  let db: Kysely<Database>;
  let app: Hono;
  let taskService: TaskService;
  let executionService: ExecutionService;

  beforeAll(async () => {
    db = await createTestDb();

    const clientRepo = createClientRepository(db);
    const clientService = createClientService(clientRepo);
    const taskRepo = createTaskRepository(db);
    const executionRepo = createExecutionRepository(db);
    const repoRepo = createRepoRepository(db);
    taskService = createTaskService(taskRepo, executionRepo, repoRepo);
    executionService = createExecutionService(db);

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({
        db,
        clientService,
        taskService,
        executionService,
      }),
    }));

    app = new Hono();
    app.use("/tasks/*", authMiddleware);
    app.route("/", tasks);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupClient = async (): Promise<{ client: Client; apiKey: string }> => {
    const { id, apiKey } = await createTestClient(db, { id: "c-1", apiKey: "test-key" });
    const client = await db
      .selectFrom("clients")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return { client, apiKey };
  };

  describe("POST /tasks/:taskId/sync", () => {
    test("syncs a task successfully", async () => {
      const { apiKey } = await setupClient();

      const res = await app.request("/tasks/task-1/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repoId: "repo-1",
          status: "READY",
          syncedAt: new Date().toISOString(),
        }),
      });
      const body = (await res.json()) as { ok: boolean };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test("returns 400 for invalid body", async () => {
      const { apiKey } = await setupClient();

      const res = await app.request("/tasks/task-1/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bad: "data" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /tasks/:taskId/ready", () => {
    test("starts a workflow for a task", async () => {
      const { apiKey } = await setupClient();
      await createSimpleWorkflow(db);

      const repoRepo = createRepoRepository(db);
      await repoRepo.upsert({ id: "repo-1", client_id: "c-1", synced_at: new Date() });

      const res = await app.request("/tasks/task-1/ready", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repoId: "repo-1", workflowName: "simple" }),
      });
      const body = (await res.json()) as { status: string };

      expect(res.status).toBe(200);
      expect(body.status).toBe("WORKING");
    });

    test("returns 400 for invalid body", async () => {
      const { apiKey } = await setupClient();

      const res = await app.request("/tasks/task-1/ready", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /tasks/:taskId/status", () => {
    test("returns task status", async () => {
      const { apiKey } = await setupClient();
      await taskService.syncTask("c-1", "task-1", "repo-1", "READY", new Date());

      const res = await app.request("/tasks/task-1/status", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = (await res.json()) as { status: string };

      expect(res.status).toBe(200);
      expect(body.status).toBe("READY");
    });

    test("returns 404 for unknown task", async () => {
      const { apiKey } = await setupClient();

      const res = await app.request("/tasks/nonexistent/status", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.status).toBe(404);
    });
  });
});
