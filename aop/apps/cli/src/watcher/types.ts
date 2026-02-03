export type WatcherEventType = "create" | "delete";

export interface WatcherEvent {
  type: WatcherEventType;
  repoId: string;
  repoPath: string;
  changeName: string;
  changePath: string;
}

export interface WatcherConfig {
  debounceMs: number;
}
