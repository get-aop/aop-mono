import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../../context.ts";
import type { Database } from "../../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { TaskStatus } from "../types.ts";
import { markTaskReady } from "./ready.ts";
import { createGitRepo } from "./test-utils.ts";

describe("tasks/handlers/ready", () => {
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

  describe("markTaskReady", () => {
    test("marks DRAFT task as READY", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DRAFT");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe(TaskStatus.READY);
        expect(result.task.ready_at).toBeDefined();
      }
    });

    test("marks BLOCKED task as READY", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "BLOCKED");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe(TaskStatus.READY);
      }
    });

    test("returns NOT_FOUND for non-existent task", async () => {
      const result = await markTaskReady(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("returns ALREADY_READY when task is already READY", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "READY");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_READY");
      }
    });

    test("returns INVALID_STATUS for terminal states", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      for (const status of ["WORKING", "DONE", "REMOVED"] as const) {
        await createTestTask(db, `task-${status}`, "repo-1", `changes/${status}`, status);
        const result = await markTaskReady(ctx, `task-${status}`);

        expect(result.success).toBe(false);
        if (!result.success && result.error.code === "INVALID_STATUS") {
          expect(result.error.status).toBe(status);
        }
      }
    });
  });
});
