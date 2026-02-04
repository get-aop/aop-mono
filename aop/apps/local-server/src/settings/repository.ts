import type { Kysely } from "kysely";
import type { Database, Setting } from "../db/schema.ts";
import { DEFAULT_SETTINGS, SettingKey } from "./types.ts";

export interface SettingsRepository {
  get: (key: SettingKey) => Promise<string>;
  set: (key: SettingKey, value: string) => Promise<void>;
  getAll: () => Promise<Setting[]>;
}

/**
 * Env var overrides for settings stored in SQLite.
 *
 * The local server persists settings (server_url, api_key) in SQLite, but during
 * development we need to override stale database values. scripts/dev.ts passes
 * AOP_SERVER_URL and AOP_API_KEY to point at the local dev server instead of
 * whatever was previously configured (e.g., production).
 */
const ENV_OVERRIDES: Partial<Record<SettingKey, string>> = {
  [SettingKey.SERVER_URL]: "AOP_SERVER_URL",
  [SettingKey.API_KEY]: "AOP_API_KEY",
};

export const createSettingsRepository = (db: Kysely<Database>): SettingsRepository => ({
  get: async (key: SettingKey): Promise<string> => {
    const envKey = ENV_OVERRIDES[key];
    if (envKey && process.env[envKey]) {
      return process.env[envKey];
    }

    const setting = await db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", key)
      .executeTakeFirst();

    return setting?.value ?? DEFAULT_SETTINGS[key];
  },

  set: async (key: SettingKey, value: string): Promise<void> => {
    await db
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
      .execute();
  },

  getAll: async (): Promise<Setting[]> => {
    return db.selectFrom("settings").selectAll().execute();
  },
});
