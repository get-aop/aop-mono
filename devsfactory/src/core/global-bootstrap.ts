import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { GlobalConfig } from "../types";
import { getGlobalDirStorage } from "./global-dir-storage";

const GLOBAL_DIR_NAME = ".aop";
const CONFIG_FILENAME = "config.yaml";
const SUBDIRECTORIES = [
  "projects",
  "tasks",
  "brainstorm",
  "worktrees"
] as const;

export const runWithGlobalDir = <T>(
  globalDir: string,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  return getGlobalDirStorage().run(globalDir, fn);
};

export const getHomeDir = (): string => {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error(
      "Unable to determine home directory: neither HOME nor USERPROFILE environment variable is set"
    );
  }
  return home;
};

export const getGlobalDir = (): string => {
  const overrideFromContext = getGlobalDirStorage().getStore();
  if (overrideFromContext !== undefined) {
    return overrideFromContext;
  }
  return join(getHomeDir(), GLOBAL_DIR_NAME);
};

export const getDefaultConfig = (): GlobalConfig => ({
  version: 1,
  defaults: {
    maxConcurrentAgents: 2,
    dashboardPort: 3001,
    debounceMs: 100,
    retryBackoff: {
      initialMs: 2000,
      maxMs: 300000,
      maxAttempts: 5
    }
  },
  providers: {
    "claude-code": {
      model: "claude-opus-4-5-20251101"
    }
  }
});

export const ensureGlobalDir = async (): Promise<string> => {
  const globalDir = getGlobalDir();
  const configPath = join(globalDir, CONFIG_FILENAME);

  await mkdir(globalDir, { recursive: true });

  const configExists = await Bun.file(configPath).exists();
  if (!configExists) {
    const defaultConfig = getDefaultConfig();
    await Bun.write(configPath, YAML.stringify(defaultConfig));
  }

  await Promise.all(
    SUBDIRECTORIES.map((subdir) =>
      mkdir(join(globalDir, subdir), { recursive: true })
    )
  );

  return globalDir;
};
