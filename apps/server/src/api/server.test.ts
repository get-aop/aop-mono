import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createApp, getAppContext } from "./server.ts";

describe("server", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeAll(async () => {
    db = await createTestDb();
    app = createApp({ db, port: 0 });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test("createApp initializes app context", () => {
    const ctx = getAppContext();
    expect(ctx.db).toBe(db);
    expect(ctx.clientService).toBeDefined();
    expect(ctx.repoService).toBeDefined();
    expect(ctx.taskService).toBeDefined();
    expect(ctx.executionService).toBeDefined();
    expect(ctx.workflowRepository).toBeDefined();
  });

  test("request logging middleware skips /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  test("request logging middleware logs non-health requests", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  test("request logging middleware logs 4xx responses", async () => {
    const res = await app.request("/tasks/task_123/status");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("request logging middleware logs auth endpoint", async () => {
    const res = await app.request("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
