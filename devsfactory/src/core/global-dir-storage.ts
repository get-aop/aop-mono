import { AsyncLocalStorage } from "node:async_hooks";

// Singleton AsyncLocalStorage instance for global directory override
// Using globalThis ensures the same instance is shared across module reimports
const STORAGE_KEY = "__aop_global_dir_storage__";

export const getGlobalDirStorage = (): AsyncLocalStorage<string> => {
  const g = globalThis as Record<string, unknown>;
  if (!g[STORAGE_KEY]) {
    g[STORAGE_KEY] = new AsyncLocalStorage<string>();
  }
  return g[STORAGE_KEY] as AsyncLocalStorage<string>;
};
