export type WatcherEventType = "create" | "delete";

export interface WatcherEvent {
  type: WatcherEventType;
  repoId: string;
  repoPath: string;
  taskName: string;
  taskPath: string;
}

export interface WatcherConfig {
  debounceMs: number;
}
