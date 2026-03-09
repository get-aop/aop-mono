import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { listWorkflows } from "./handlers.ts";

describe("listWorkflows", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("returns built-in local workflows", async () => {
    const result = await listWorkflows(ctx.workflowService);
    expect(result.workflows).toContain("aop-default");
    expect(result.workflows).toContain("simple");
  });

  test("returns workflows in sorted order", async () => {
    const result = await listWorkflows(ctx.workflowService);
    expect(result.workflows).toEqual([...result.workflows].sort());
  });
});
