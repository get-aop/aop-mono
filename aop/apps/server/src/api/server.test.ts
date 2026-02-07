import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createServer, getAppContext } from "./server.ts";

describe("server", () => {
  let db: Kysely<Database>;
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    server?.stop(true);
    await db.destroy();
  });

  test("createServer initializes app context", () => {
    server = createServer({ db, port: 0 });

    const ctx = getAppContext();
    expect(ctx.db).toBe(db);
    expect(ctx.clientService).toBeDefined();
    expect(ctx.repoService).toBeDefined();
    expect(ctx.taskService).toBeDefined();
    expect(ctx.executionService).toBeDefined();
    expect(ctx.workflowRepository).toBeDefined();
  });
});
