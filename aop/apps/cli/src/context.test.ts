import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext } from "./context.ts";
import type { Database } from "./db/index.ts";
import { createTestDb } from "./db/test-utils.ts";

describe("context", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("createCommandContext", () => {
    test("creates all required repositories", () => {
      const ctx = createCommandContext(db);

      expect(ctx.taskRepository).toBeDefined();
      expect(ctx.repoRepository).toBeDefined();
      expect(ctx.settingsRepository).toBeDefined();
      expect(ctx.executionRepository).toBeDefined();
    });

    test("creates functional task repository", async () => {
      const ctx = createCommandContext(db);

      await ctx.repoRepository.create({
        id: "repo-1",
        path: "/test/path",
        name: "test",
        remote_origin: null,
      });

      const task = await ctx.taskRepository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/test",
        status: "DRAFT",
      });

      expect(task.id).toBe("task-1");
    });
  });
});
