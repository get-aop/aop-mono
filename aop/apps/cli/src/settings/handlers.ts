import type { CommandContext } from "../context.ts";
import { DEFAULT_SETTINGS, isValidSettingKey, type SettingKey, VALID_KEYS } from "./types.ts";

export type GetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: GetSettingError };

export type GetSettingError = { code: "INVALID_KEY"; key: string; validKeys: SettingKey[] };

export type GetAllSettingsResult = {
  success: true;
  settings: Array<{ key: string; value: string }>;
};

export type SetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: SetSettingError };

export type SetSettingError = { code: "INVALID_KEY"; key: string; validKeys: SettingKey[] };

export const getSetting = async (ctx: CommandContext, key: string): Promise<GetSettingResult> => {
  if (!isValidSettingKey(key)) {
    return {
      success: false,
      error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
    };
  }

  const value = await ctx.settingsRepository.get(key);
  return { success: true, key, value };
};

export const getAllSettings = async (ctx: CommandContext): Promise<GetAllSettingsResult> => {
  const dbSettings = await ctx.settingsRepository.getAll();
  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const settings = VALID_KEYS.map((key) => ({
    key,
    value: settingsMap.get(key) ?? DEFAULT_SETTINGS[key],
  }));

  return { success: true, settings };
};

export const setSetting = async (
  ctx: CommandContext,
  key: string,
  value: string,
): Promise<SetSettingResult> => {
  if (!isValidSettingKey(key)) {
    return {
      success: false,
      error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
    };
  }

  await ctx.settingsRepository.set(key, value);
  return { success: true, key, value };
};
