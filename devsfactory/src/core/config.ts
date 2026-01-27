import { type Config, ConfigSchema } from "../types";

const parseIntEnv = (key: string): number | undefined => {
  const value = process.env[key];
  return value ? parseInt(value, 10) : undefined;
};

export const loadConfig = (): Config => {
  return ConfigSchema.parse({
    devsfactoryDir: process.env.DEVSFACTORY_DIR,
    worktreesDir: process.env.WORKTREES_DIR,
    maxConcurrentAgents: parseIntEnv("MAX_CONCURRENT_AGENTS"),
    debounceMs: parseIntEnv("DEBOUNCE_MS"),
    retryBackoff: {
      initialMs: parseIntEnv("RETRY_INITIAL_MS"),
      maxMs: parseIntEnv("RETRY_MAX_MS"),
      maxAttempts: parseIntEnv("RETRY_MAX_ATTEMPTS")
    }
  });
};
