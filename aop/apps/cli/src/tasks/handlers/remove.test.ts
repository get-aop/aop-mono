import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../../context.ts";
import type { Database } from "../../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { TaskStatus } from "../types.ts";
import { removeTask } from "./remove.ts";
import { createGitRepo } from "./test-utils.ts";

describe("tasks/handlers/remove", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await createGitRepo();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("removeTask", () => {
    test("removes task in non-working state", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      for (const status of ["DRAFT", "READY", "BLOCKED", "DONE"] as const) {
        await createTestTask(db, `task-${status}`, "repo-1", `changes/${status}`, status);
        const result = await removeTask(ctx, `task-${status}`);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.aborted).toBe(false);
        }

        const task = await ctx.taskRepository.get(`task-${status}`);
        expect(task?.status).toBe(TaskStatus.REMOVED);
      }
    });

    test("returns NOT_FOUND for non-existent task", async () => {
      const result = await removeTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("returns ALREADY_REMOVED for removed task", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "REMOVED");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_REMOVED");
      }
    });

    test("returns TASK_WORKING for working task without force", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TASK_WORKING");
      }
    });
  });
});
