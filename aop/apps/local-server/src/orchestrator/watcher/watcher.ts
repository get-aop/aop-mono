import { existsSync, type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import { aopPaths, getLogger } from "@aop/infra";
import type { WatcherConfig, WatcherEvent } from "./types.ts";

const logger = getLogger("aop", "watcher");

const DEFAULT_DEBOUNCE_MS = 500;

export interface RepoWatcher {
  repoId: string;
  repoPath: string;
  watchers: FSWatcher[];
}

export interface WatcherManager {
  addRepo: (repoId: string, repoPath: string) => void;
  removeRepo: (repoId: string) => void;
  stop: () => void;
}

export const createWatcherManager = (
  onEvent: (event: WatcherEvent) => void,
  config: Partial<WatcherConfig> = {},
): WatcherManager => {
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchers = new Map<string, RepoWatcher>();
  const debounceTimers = new Map<string, Timer>();

  const emitDebounced = (event: WatcherEvent) => {
    const key = `${event.repoId}:${event.changeName}`;
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      onEvent(event);
    }, debounceMs);

    debounceTimers.set(key, timer);
  };

  const watchDir = (
    dir: string,
    repoId: string,
    repoPath: string,
    changesPath: string,
  ): FSWatcher | null => {
    if (!existsSync(dir)) return null;

    try {
      return watch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const changeName = extractChangeName(filename);
        if (!changeName) return;

        const type = determineEventType(join(changesPath, changeName));
        emitDebounced({
          type,
          repoId,
          repoPath,
          changeName,
          changePath: join(changesPath, changeName),
        });
      });
    } catch (err) {
      logger.error("Failed to watch directory {dir}: {error}", { dir, repoId, error: String(err) });
      return null;
    }
  };

  const addRepo = (repoId: string, repoPath: string) => {
    if (watchers.has(repoId)) return;

    const globalChangesPath = aopPaths.openspecChanges(repoId);
    const globalWatcher = watchDir(globalChangesPath, repoId, repoPath, globalChangesPath);

    if (!globalWatcher) {
      logger.warn("Global openspec/changes directory not found for repo {repoId}", {
        repoId,
        repoPath,
      });
      return;
    }

    watchers.set(repoId, { repoId, repoPath, watchers: [globalWatcher] });
    logger.info("Started watching repo: {repoPath}", { repoId, repoPath });
  };

  const removeRepo = (repoId: string) => {
    const entry = watchers.get(repoId);
    if (!entry) return;

    for (const w of entry.watchers) w.close();
    watchers.delete(repoId);
    logger.info("Stopped watching repo: {repoId}", { repoId });
  };

  const stop = () => {
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();

    for (const { watchers: ws, repoId } of watchers.values()) {
      for (const w of ws) w.close();
      logger.debug("Closed watcher for repo: {repoId}", { repoId });
    }
    watchers.clear();
    logger.info("All watchers stopped");
  };

  return { addRepo, removeRepo, stop };
};

const extractChangeName = (filename: string): string | null => {
  const parts = filename.split("/");
  return parts[0] ?? null;
};

const determineEventType = (changePath: string): "create" | "delete" => {
  return existsSync(changePath) ? "create" : "delete";
};
