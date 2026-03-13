import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { cleanupRemovedWorktrees, getAllSettings, setAllSettings, setSetting } from "./handlers.ts";

describe("settings/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  const originalLocalServerUrl = process.env.AOP_LOCAL_SERVER_URL;

  beforeEach(async () => {
    process.env.AOP_LOCAL_SERVER_URL = "http://127.0.0.1:25150";
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    if (originalLocalServerUrl === undefined) {
      delete process.env.AOP_LOCAL_SERVER_URL;
      return;
    }
    process.env.AOP_LOCAL_SERVER_URL = originalLocalServerUrl;
  });

  describe("getAllSettings", () => {
    test("includes the default workflow setting", async () => {
      const result = await getAllSettings(ctx);
      const workflowSetting = result.settings.find((setting) => setting.key === "default_workflow");

      expect(workflowSetting).toEqual({
        key: "default_workflow",
        value: "aop-default",
      });
    });

    test("normalizes the legacy Linear callback url for source installs", async () => {
      await ctx.settingsRepository.set(
        "linear_callback_url",
        "http://127.0.0.1:4310/api/linear/callback",
      );

      const result = await getAllSettings(ctx);
      const callbackSetting = result.settings.find(
        (setting) => setting.key === "linear_callback_url",
      );

      expect(callbackSetting).toEqual({
        key: "linear_callback_url",
        value: "http://127.0.0.1:25150/api/linear/callback",
      });
    });
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
        "codex",
        "e2e-fixture",
        "opencode:opencode/kimi-k2.5",
        "opencode:opencode/kimi-k2.5-free",
        "opencode:openai/gpt-5.3-codex/medium",
        "opencode:openai/gpt-5.3-codex/high",
        "opencode:openai/gpt-5.3-codex/xhigh",
        "opencode:openai/gpt-5.3-codex/low",
        "cursor-cli:composer-1.5",
      ]) {
        const result = await setAllSettings(ctx, [{ key: "agent_provider", value }]);
        expect(result.success).toBe(true);
      }
    });

    test("saves Linear OAuth settings", async () => {
      const result = await setAllSettings(ctx, [
        { key: "linear_client_id", value: "linear-client-id" },
        { key: "linear_callback_url", value: "http://127.0.0.1:4310/api/linear/callback" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(await ctx.settingsRepository.get("linear_client_id")).toBe("linear-client-id");
      expect(await ctx.settingsRepository.get("linear_callback_url")).toBe(
        "http://127.0.0.1:4310/api/linear/callback",
      );
    });

    test("rejects an invalid Linear callback URL", async () => {
      const result = await setAllSettings(ctx, [
        { key: "linear_callback_url", value: "not-a-url" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.key).toBe("linear_callback_url");
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
      const result = await setSetting(ctx, "agent_provider", "codex");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value).toBe("codex");
    });

    test("accepts a valid default workflow value", async () => {
      const result = await setSetting(ctx, "default_workflow", "simple");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value).toBe("simple");
    });

    test("rejects an unknown default workflow value", async () => {
      const result = await setSetting(ctx, "default_workflow", "missing-workflow");

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.key).toBe("default_workflow");
    });

    test("accepts an empty Linear callback URL to clear the override", async () => {
      const result = await setSetting(ctx, "linear_callback_url", "");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value).toBe("");
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
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/test", "REMOVED");

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });

    test("ignores removed tasks from unregistered repos", async () => {
      await createTestTask(db, "task-orphan", "nonexistent-repo", "changes/test", "REMOVED");

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });

    test("skips non-REMOVED tasks", async () => {
      await createTestTask(db, "task-working", TEST_REPO_ID, "changes/test", "WORKING");

      const result = await cleanupRemovedWorktrees(ctx);
      expect(result).toEqual({ cleaned: 0, failed: 0 });
    });
  });
});
