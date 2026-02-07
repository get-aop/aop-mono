import { GitManager } from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { DEFAULT_SETTINGS, isValidSettingKey, type SettingKey, VALID_KEYS } from "./types.ts";

const logger = getLogger("settings");

export type GetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: GetSettingError };

export type GetSettingError = {
  code: "INVALID_KEY";
  key: string;
  validKeys: SettingKey[];
};

export type GetAllSettingsResult = {
  success: true;
  settings: Array<{ key: string; value: string }>;
};

export type SetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: SetSettingError };

export type SetSettingError = {
  code: "INVALID_KEY";
  key: string;
  validKeys: SettingKey[];
};

export const getSetting = async (
  ctx: LocalServerContext,
  key: string,
): Promise<GetSettingResult> => {
  if (!isValidSettingKey(key)) {
    return {
      success: false,
      error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
    };
  }

  const value = await ctx.settingsRepository.get(key);
  return { success: true, key, value };
};

export const getAllSettings = async (ctx: LocalServerContext): Promise<GetAllSettingsResult> => {
  const dbSettings = await ctx.settingsRepository.getAll();
  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const settings = VALID_KEYS.map((key) => ({
    key,
    value: settingsMap.get(key) ?? DEFAULT_SETTINGS[key],
  }));

  return { success: true, settings };
};

export const setSetting = async (
  ctx: LocalServerContext,
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

export type SetAllSettingsResult =
  | { success: true; settings: Array<{ key: string; value: string }> }
  | { success: false; error: SetSettingError };

export const setAllSettings = async (
  ctx: LocalServerContext,
  entries: Array<{ key: string; value: string }>,
): Promise<SetAllSettingsResult> => {
  for (const entry of entries) {
    if (!isValidSettingKey(entry.key)) {
      return {
        success: false,
        error: { code: "INVALID_KEY", key: entry.key, validKeys: VALID_KEYS },
      };
    }
  }

  const validated = entries as Array<{ key: SettingKey; value: string }>;
  await ctx.settingsRepository.setAll(validated);
  return { success: true, settings: validated };
};

export interface CleanupResult {
  cleaned: number;
  failed: number;
}

export const cleanupRemovedWorktrees = async (ctx: LocalServerContext): Promise<CleanupResult> => {
  const removedTasks = await ctx.taskRepository.list({ status: "REMOVED" });
  const tasksWithWorktrees = removedTasks.filter((t) => t.worktree_path);

  let cleaned = 0;
  let failed = 0;

  for (const task of tasksWithWorktrees) {
    const repo = await ctx.repoRepository.getById(task.repo_id);
    if (!repo) {
      logger.warn("Repo {repoId} not found for task {taskId}, skipping", {
        repoId: task.repo_id,
        taskId: task.id,
      });
      failed++;
      continue;
    }

    const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });

    try {
      await gitManager.forceRemoveWorktree(task.id);
      cleaned++;
    } catch (err) {
      logger.warn("Failed to cleanup worktree for task {taskId}: {error}", {
        taskId: task.id,
        error: String(err),
      });
      failed++;
    }
  }

  logger.info("Worktree cleanup complete: {cleaned} cleaned, {failed} failed", {
    cleaned,
    failed,
  });

  return { cleaned, failed };
};

export const checkDbConnection = async (ctx: LocalServerContext): Promise<boolean> => {
  try {
    await ctx.settingsRepository.get("max_concurrent_tasks");
    return true;
  } catch {
    return false;
  }
};
