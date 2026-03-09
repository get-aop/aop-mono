export const TaskStatus = {
  DRAFT: "DRAFT",
  READY: "READY",
  RESUMING: "RESUMING",
  WORKING: "WORKING",
  PAUSED: "PAUSED",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
  REMOVED: "REMOVED",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export interface Task {
  id: string;
  repoId: string;
  changePath: string;
  worktreePath: string | null;
  status: TaskStatus;
  baseBranch: string | null;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
