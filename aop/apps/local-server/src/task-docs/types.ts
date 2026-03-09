import type { TaskStatus } from "@aop/common";

export interface TaskDocFrontmatter extends Record<string, unknown> {
  title: string;
  status: string;
  created?: string;
  priority?: string;
  tags?: string[];
  assignee?: string | null;
  dependencies?: string[];
  branch?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
}

export interface TaskDoc {
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  branch: string | null;
  description: string;
  requirements: string;
  acceptanceCriteria: Array<{ text: string; checked: boolean }>;
}

export interface SubtaskDocFrontmatter extends Record<string, unknown> {
  title?: string;
  status?: string;
  dependencies?: number[];
}

export interface SubtaskDoc {
  filename: string;
  status: string;
}
