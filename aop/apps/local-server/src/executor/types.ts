import type { Task } from "../db/schema.ts";

export interface ExecuteResult {
  exitCode: number;
  sessionId?: string;
  status: "success" | "failure" | "timeout";
  signal?: string;
}

export interface ExecutorContext {
  task: Task;
  repoId: string;
  repoPath: string;
  changePath: string;
  worktreePath: string;
  logsDir: string;
  timeoutSecs: number;
}
