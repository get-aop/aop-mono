import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { cleanupTestDb, createTestDb, createTestWorkflow } from "../../db/test-utils.ts";
import { createWorkflowRepository } from "../../workflow/workflow-repository.ts";
import type { AppContext } from "../server.ts";
import { workflows } from "./workflows.ts";

describe("GET /workflows", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeAll(async () => {
    db = await createTestDb();

    const workflowRepository = createWorkflowRepository(db);

    // Mock getAppContext to return our test context
    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({
        workflowRepository,
      }),
    }));

    app = new Hono();
    app.route("/", workflows);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test("returns empty workflows when none exist", async () => {
    const res = await app.request("/workflows");
    const body = (await res.json()) as { workflows: string[] };

    expect(res.status).toBe(200);
    expect(body.workflows).toEqual([]);
  });

  test("returns workflow names", async () => {
    await createTestWorkflow(db, { id: "w-1", name: "aop-default" });
    await createTestWorkflow(db, { id: "w-2", name: "custom-workflow" });

    const res = await app.request("/workflows");
    const body = (await res.json()) as { workflows: string[] };

    expect(res.status).toBe(200);
    expect(body.workflows).toEqual(["aop-default", "custom-workflow"]);
  });
});
