import type { StepExecution, Task } from "../db/schema.ts";

export type StepWithTask = StepExecution & { task_id: string };

export interface ExecuteResult {
  exitCode: number;
  sessionId?: string;
  status: "success" | "failure" | "timeout";
  signal?: string;
  pauseContext?: string;
}

export interface ExecutorContext {
  task: Task;
  repoId: string;
  repoPath: string;
  changePath: string;
  worktreePath: string;
  logsDir: string;
  timeoutSecs: number;
  fastMode: boolean;
}
