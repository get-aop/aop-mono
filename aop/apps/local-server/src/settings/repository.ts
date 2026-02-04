import type { Kysely } from "kysely";
import type { Database, Setting } from "../db/schema.ts";
import { DEFAULT_SETTINGS, type SettingKey } from "./types.ts";

export interface SettingsRepository {
  get: (key: SettingKey) => Promise<string>;
  set: (key: SettingKey, value: string) => Promise<void>;
  getAll: () => Promise<Setting[]>;
}

export const createSettingsRepository = (db: Kysely<Database>): SettingsRepository => ({
  get: async (key: SettingKey): Promise<string> => {
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
