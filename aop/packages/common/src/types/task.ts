export const TaskStatus = {
  DRAFT: "DRAFT",
  READY: "READY",
  WORKING: "WORKING",
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
  readyAt: Date | null;
  remoteId: string | null;
  syncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
