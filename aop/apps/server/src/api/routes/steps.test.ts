import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createClientRepository } from "../../clients/client-repository.ts";
import { createClientService } from "../../clients/client-service.ts";
import type { Client, Database } from "../../db/schema.ts";
import {
  cleanupTestDb,
  createPausedWorkflow,
  createSimpleWorkflow,
  createTestClient,
  createTestDb,
} from "../../db/test-utils.ts";
import { createExecutionService, type ExecutionService } from "../../executions/index.ts";
import { createRepoRepository } from "../../repos/repo-repository.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { AppContext } from "../server.ts";
import { steps } from "./steps.ts";

describe("POST /steps/:stepId/complete", () => {
  let db: Kysely<Database>;
  let app: Hono;
  let executionService: ExecutionService;

  beforeAll(async () => {
    db = await createTestDb();
    const clientRepo = createClientRepository(db);
    const clientService = createClientService(clientRepo);
    executionService = createExecutionService(db);

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({ db, clientService, executionService }),
    }));

    app = new Hono();
    app.use("/steps/*", authMiddleware);
    app.route("/", steps);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupWorkflow = async (): Promise<{ client: Client; apiKey: string }> => {
    const { id, apiKey } = await createTestClient(db, { id: "c-1", apiKey: "test-key" });
    await createSimpleWorkflow(db);

    const repoRepo = createRepoRepository(db);
    await repoRepo.upsert({ id: "repo-1", client_id: id, synced_at: new Date() });

    const client = await db
      .selectFrom("clients")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    return { client, apiKey };
  };

  test("completes a step successfully", async () => {
    const { client, apiKey } = await setupWorkflow();
    const workflowResult = await executionService.startWorkflow(
      client,
      "task-1",
      "repo-1",
      "simple",
    );

    const stepId = workflowResult.step?.id;
    const executionId = workflowResult.execution?.id;

    const res = await app.request(`/steps/${stepId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        executionId,
        attempt: 1,
        status: "success",
        durationMs: 5000,
      }),
    });
    const body = (await res.json()) as { taskStatus: string };

    expect(res.status).toBe(200);
    expect(body.taskStatus).toBe("DONE");
  });

  test("returns 400 for missing required fields", async () => {
    const { apiKey } = await setupWorkflow();

    const res = await app.request("/steps/step-fake/complete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bad: "data" }),
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });
});

describe("POST /steps/:stepId/resume", () => {
  let db: Kysely<Database>;
  let app: Hono;
  let executionService: ExecutionService;

  beforeAll(async () => {
    db = await createTestDb();
    const clientRepo = createClientRepository(db);
    const clientService = createClientService(clientRepo);
    executionService = createExecutionService(db);

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({ db, clientService, executionService }),
    }));

    app = new Hono();
    app.use("/steps/*", authMiddleware);
    app.route("/", steps);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupPausedWorkflow = async () => {
    const { id, apiKey } = await createTestClient(db, { id: "c-1", apiKey: "test-key" });
    await createPausedWorkflow(db);

    const repoRepo = createRepoRepository(db);
    await repoRepo.upsert({ id: "repo-1", client_id: id, synced_at: new Date() });

    const client = await db
      .selectFrom("clients")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    const startResult = await executionService.startWorkflow(
      client,
      "task-1",
      "repo-1",
      "paused-test",
    );

    await executionService.processStepResult(client, {
      stepId: startResult.step?.id ?? "",
      executionId: startResult.execution?.id ?? "",
      attempt: 1,
      status: "success",
      signal: "REQUIRES_INPUT",
      durationMs: 1000,
    });

    return { client, apiKey, stepId: startResult.step?.id ?? "" };
  };

  test("resumes a paused step successfully", async () => {
    const { apiKey, stepId } = await setupPausedWorkflow();

    const res = await app.request(`/steps/${stepId}/resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "Approved. Proceed with the plan." }),
    });
    const body = (await res.json()) as { taskStatus: string };

    expect(res.status).toBe(200);
    expect(body.taskStatus).toBe("WORKING");
  });

  test("returns 400 for missing input field", async () => {
    const { apiKey } = await setupPausedWorkflow();

    const res = await app.request("/steps/step-fake/resume", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bad: "data" }),
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });
});
