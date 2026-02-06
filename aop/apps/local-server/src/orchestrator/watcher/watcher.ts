import { existsSync, type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import type { WatcherConfig, WatcherEvent } from "./types.ts";

const logger = getLogger("aop", "watcher");

const DEFAULT_DEBOUNCE_MS = 500;
const CHANGES_DIR = "openspec/changes";

export interface RepoWatcher {
  repoId: string;
  repoPath: string;
  watcher: FSWatcher;
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

  const addRepo = (repoId: string, repoPath: string) => {
    if (watchers.has(repoId)) {
      return;
    }

    const changesPath = join(repoPath, CHANGES_DIR);

    if (!existsSync(changesPath)) {
      logger.warn("Skipping watch - no openspec/changes directory: {repoPath}", {
        repoId,
        repoPath,
      });
      return;
    }

    try {
      const watcher = watch(changesPath, { recursive: true }, (_eventType, filename) => {
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

      watchers.set(repoId, { repoId, repoPath, watcher });
      logger.info("Started watching repo: {repoPath}", { repoId, repoPath });
    } catch (err) {
      logger.error("Failed to watch repo: {error}", { repoId, repoPath, error: String(err) });
    }
  };

  const removeRepo = (repoId: string) => {
    const watcher = watchers.get(repoId);
    if (!watcher) return;

    watcher.watcher.close();
    watchers.delete(repoId);
    logger.info("Stopped watching repo: {repoId}", { repoId });
  };

  const stop = () => {
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();

    for (const { watcher, repoId } of watchers.values()) {
      watcher.close();
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
