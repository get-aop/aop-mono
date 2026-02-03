import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { DEFAULT_SETTINGS, SettingKey } from "../settings/types.ts";
import { getFullStatus } from "./status.ts";

describe("daemon/status", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("getFullStatus", () => {
    test("returns status with no repos", async () => {
      const result = await getFullStatus(ctx, { pidFile: "/tmp/nonexistent.pid" });

      expect(result.success).toBe(true);
      expect(result.status.daemon.running).toBe(false);
      expect(result.status.daemon.pid).toBeNull();
      expect(result.status.globalCapacity.working).toBe(0);
      expect(result.status.globalCapacity.max).toBe(
        Number.parseInt(DEFAULT_SETTINGS[SettingKey.MAX_CONCURRENT_TASKS], 10),
      );
      expect(result.status.repos).toHaveLength(0);
    });

    test("returns status with repos and tasks", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project-a");
      await createTestRepo(db, "repo-2", "/home/user/project-b");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "READY");
      await createTestTask(db, "task-3", "repo-2", "changes/feature-c", "DONE");

      const result = await getFullStatus(ctx, { pidFile: "/tmp/nonexistent.pid" });

      expect(result.success).toBe(true);
      expect(result.status.globalCapacity.working).toBe(1);
      expect(result.status.repos).toHaveLength(2);

      const repo1 = result.status.repos.find((r) => r.id === "repo-1");
      expect(repo1).toBeDefined();
      expect(repo1?.working).toBe(1);
      expect(repo1?.tasks).toHaveLength(2);

      const repo2 = result.status.repos.find((r) => r.id === "repo-2");
      expect(repo2).toBeDefined();
      expect(repo2?.working).toBe(0);
      expect(repo2?.tasks).toHaveLength(1);
    });

    test("excludes removed tasks from repo tasks", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "REMOVED");

      const result = await getFullStatus(ctx, { pidFile: "/tmp/nonexistent.pid" });

      expect(result.success).toBe(true);
      const repo = result.status.repos.find((r) => r.id === "repo-1");
      expect(repo).toBeDefined();
      expect(repo?.tasks).toHaveLength(1);
      expect(repo?.tasks[0]?.id).toBe("task-1");
    });

    test("uses custom max_concurrent_tasks setting", async () => {
      await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "5");

      const result = await getFullStatus(ctx, { pidFile: "/tmp/nonexistent.pid" });

      expect(result.success).toBe(true);
      expect(result.status.globalCapacity.max).toBe(5);
    });
  });
});
