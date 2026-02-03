import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/index.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createSettingsRepository, type SettingsRepository } from "./repository.ts";
import { DEFAULT_SETTINGS, SettingKey } from "./types.ts";

describe("SettingsRepository", () => {
  let db: Kysely<Database>;
  let repository: SettingsRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createSettingsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("get", () => {
    test("returns value from database when set", async () => {
      await db
        .updateTable("settings")
        .set({ value: "5" })
        .where("key", "=", SettingKey.MAX_CONCURRENT_TASKS)
        .execute();

      const value = await repository.get(SettingKey.MAX_CONCURRENT_TASKS);

      expect(value).toBe("5");
    });

    test("returns default value when not in database", async () => {
      await db.deleteFrom("settings").where("key", "=", SettingKey.MAX_CONCURRENT_TASKS).execute();

      const value = await repository.get(SettingKey.MAX_CONCURRENT_TASKS);

      expect(value).toBe(DEFAULT_SETTINGS[SettingKey.MAX_CONCURRENT_TASKS]);
    });

    test("returns correct defaults for each known key", async () => {
      await db.deleteFrom("settings").execute();

      for (const key of Object.values(SettingKey)) {
        const value = await repository.get(key);
        expect(value).toBe(DEFAULT_SETTINGS[key]);
      }
    });
  });

  describe("set", () => {
    test("inserts new setting", async () => {
      await db.deleteFrom("settings").where("key", "=", SettingKey.MAX_CONCURRENT_TASKS).execute();

      await repository.set(SettingKey.MAX_CONCURRENT_TASKS, "10");

      const result = await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", SettingKey.MAX_CONCURRENT_TASKS)
        .executeTakeFirst();

      expect(result?.value).toBe("10");
    });

    test("updates existing setting", async () => {
      await repository.set(SettingKey.MAX_CONCURRENT_TASKS, "3");
      await repository.set(SettingKey.MAX_CONCURRENT_TASKS, "7");

      const value = await repository.get(SettingKey.MAX_CONCURRENT_TASKS);

      expect(value).toBe("7");
    });
  });

  describe("getAll", () => {
    test("returns all settings from database", async () => {
      const settings = await repository.getAll();

      expect(settings.length).toBeGreaterThanOrEqual(4);

      const keys = settings.map((s) => s.key);
      expect(keys).toContain(SettingKey.MAX_CONCURRENT_TASKS);
      expect(keys).toContain(SettingKey.WATCHER_POLL_INTERVAL_SECS);
      expect(keys).toContain(SettingKey.QUEUE_POLL_INTERVAL_SECS);
      expect(keys).toContain(SettingKey.AGENT_TIMEOUT_SECS);
    });

    test("returns empty array when no settings", async () => {
      await db.deleteFrom("settings").execute();

      const settings = await repository.getAll();

      expect(settings).toHaveLength(0);
    });
  });
});
