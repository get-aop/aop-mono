import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";

describe("LocalWorkflowService", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("syncs built-in workflows into the local database on first use", async () => {
    const workflows = await ctx.workflowService.listWorkflows();

    expect(workflows).toContain("aop-default");
    expect(workflows).toContain("simple");

    const persisted = await ctx.workflowRepository.findByName("aop-default");
    expect(persisted).not.toBeNull();

    const definition = persisted ? JSON.parse(persisted.definition) : null;
    expect(definition?.name).toBe("aop-default");
    expect(definition?.initialStep).toBe("iterate");
  });
});
