import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/index.ts";
import { createTestDb } from "../db/test-utils.ts";
import { getAllSettings, getSetting, setSetting } from "./handlers.ts";
import { DEFAULT_SETTINGS, SettingKey } from "./types.ts";

describe("settings/handlers", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("getSetting", () => {
    test("returns default value for unset key", async () => {
      const result = await getSetting(ctx, SettingKey.MAX_CONCURRENT_TASKS);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key).toBe(SettingKey.MAX_CONCURRENT_TASKS);
        expect(result.value).toBe(DEFAULT_SETTINGS[SettingKey.MAX_CONCURRENT_TASKS]);
      }
    });

    test("returns stored value for set key", async () => {
      await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "5");

      const result = await getSetting(ctx, SettingKey.MAX_CONCURRENT_TASKS);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe("5");
      }
    });

    test("returns error for invalid key", async () => {
      const result = await getSetting(ctx, "invalid_key");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_KEY");
        expect(result.error.key).toBe("invalid_key");
        expect(result.error.validKeys).toContain(SettingKey.MAX_CONCURRENT_TASKS);
      }
    });
  });

  describe("getAllSettings", () => {
    test("returns all settings with defaults", async () => {
      const result = await getAllSettings(ctx);

      expect(result.success).toBe(true);
      expect(result.settings).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);

      const maxTasks = result.settings.find((s) => s.key === SettingKey.MAX_CONCURRENT_TASKS);
      expect(maxTasks?.value).toBe(DEFAULT_SETTINGS[SettingKey.MAX_CONCURRENT_TASKS]);
    });

    test("returns stored values merged with defaults", async () => {
      await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "10");

      const result = await getAllSettings(ctx);

      expect(result.success).toBe(true);

      const maxTasks = result.settings.find((s) => s.key === SettingKey.MAX_CONCURRENT_TASKS);
      expect(maxTasks?.value).toBe("10");

      const pollInterval = result.settings.find(
        (s) => s.key === SettingKey.WATCHER_POLL_INTERVAL_SECS,
      );
      expect(pollInterval?.value).toBe(DEFAULT_SETTINGS[SettingKey.WATCHER_POLL_INTERVAL_SECS]);
    });
  });

  describe("setSetting", () => {
    test("sets a valid setting", async () => {
      const result = await setSetting(ctx, SettingKey.MAX_CONCURRENT_TASKS, "3");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key).toBe(SettingKey.MAX_CONCURRENT_TASKS);
        expect(result.value).toBe("3");
      }

      const stored = await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS);
      expect(stored).toBe("3");
    });

    test("overwrites existing value", async () => {
      await ctx.settingsRepository.set(SettingKey.AGENT_TIMEOUT_SECS, "100");

      const result = await setSetting(ctx, SettingKey.AGENT_TIMEOUT_SECS, "200");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe("200");
      }

      const stored = await ctx.settingsRepository.get(SettingKey.AGENT_TIMEOUT_SECS);
      expect(stored).toBe("200");
    });

    test("returns error for invalid key", async () => {
      const result = await setSetting(ctx, "not_a_real_setting", "value");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_KEY");
        expect(result.error.key).toBe("not_a_real_setting");
      }
    });
  });
});
