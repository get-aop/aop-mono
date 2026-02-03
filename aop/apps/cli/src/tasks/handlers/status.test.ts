import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../../context.ts";
import type { Database } from "../../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { getTaskStatus } from "./status.ts";

describe("tasks/handlers/status", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("getTaskStatus", () => {
    test("returns task by id", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");

      const result = await getTaskStatus(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.id).toBe("task-1");
        expect(result.task.status).toBe("WORKING");
        expect(result.task.change_path).toBe("changes/feature-a");
      }
    });

    test("returns error for non-existent task", async () => {
      const result = await getTaskStatus(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect(result.error.identifier).toBe("non-existent");
      }
    });
  });
});
