import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { cleanupRemovedWorktrees, setAllSettings, setSetting } from "./handlers.ts";

describe("settings/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("setAllSettings", () => {
    test("saves multiple settings at once", async () => {
      const result = await setAllSettings(ctx, [
        { key: "max_concurrent_tasks", value: "5" },
        { key: "agent_timeout_secs", value: "900" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(2);

      const stored = await ctx.settingsRepository.get("max_concurrent_tasks");
      expect(stored).toBe("5");
      const stored2 = await ctx.settingsRepository.get("agent_timeout_secs");
      expect(stored2).toBe("900");
    });

    test("rejects if any key is invalid", async () => {
      const result = await setAllSettings(ctx, [
        { key: "max_concurrent_tasks", value: "5" },
        { key: "bogus_key", value: "nope" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_KEY");
      expect(result.error.key).toBe("bogus_key");
    });

    test("handles empty array", async () => {
      const result = await setAllSettings(ctx, []);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(0);
    });

    test("rejects invalid agent_provider value", async () => {
      const result = await setAllSettings(ctx, [
        { key: "agent_provider", value: "invalid-provider" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
    });

    test("accepts valid agent_provider values", async () => {
      for (const value of [
        "claude-code",
        "opencode:opencode/kimi-k2.5",
        "opencode:opencode/kimi-k2.5-free",
        "opencode:openai/gpt-5.3-codex",
        "cursor-cli:composer-1.5",
      ]) {
        const result = await setAllSettings(ctx, [{ key: "agent_provider", value }]);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("setSetting", () => {
    test("rejects invalid agent_provider value", async () => {
      const result = await setSetting(ctx, "agent_provider", "bad-value");

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
    });

    test("accepts valid agent_provider value", async () => {
      const result = await setSetting(ctx, "agent_provider", "cursor-cli:composer-1.5");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value).toBe("cursor-cli:composer-1.5");
    });
  });

  describe("cleanupRemovedWorktrees", () => {
    const TEST_REPO_ID = "repo_cleanup_test";
    const TEST_REPO_PATH = "/tmp/cleanup-test-repo";

    beforeEach(async () => {
      await createTestRepo(db, TEST_REPO_ID, TEST_REPO_PATH);
    });

    test("returns zero counts when no removed tasks exist", async () => {
      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });

    test("returns zero counts when removed tasks have no worktree_path", async () => {
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: TEST_REPO_ID,
          change_path: "changes/test",
          status: "REMOVED",
          worktree_path: null,
        })
        .execute();

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });

    test("counts failed when repo is not found", async () => {
      await db
        .insertInto("tasks")
        .values({
          id: "task-orphan",
          repo_id: "nonexistent-repo",
          change_path: "changes/test",
          status: "REMOVED",
          worktree_path: "/tmp/some-worktree",
        })
        .execute();

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result.failed).toBe(1);
      expect(result.cleaned).toBe(0);
    });

    test("skips non-REMOVED tasks", async () => {
      await db
        .insertInto("tasks")
        .values({
          id: "task-working",
          repo_id: TEST_REPO_ID,
          change_path: "changes/test",
          status: "WORKING",
          worktree_path: "/tmp/some-worktree",
        })
        .execute();

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });
  });
});
