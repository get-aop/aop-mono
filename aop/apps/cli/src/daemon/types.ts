import type { Task } from "../db/schema.ts";
import type { ServerSync } from "../sync/server-sync.ts";

export interface DaemonConfig {
  dbPath?: string;
  pidFile?: string;
  /** Optional pre-configured ServerSync instance (for testing) */
  serverSync?: ServerSync;
}

export interface ExecutingTask {
  task: Task;
  promise: Promise<void>;
}
