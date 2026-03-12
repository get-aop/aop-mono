import type { TaskStatus } from "@aop/common";

export interface TaskSourceMetadata {
  provider: "linear";
  id: string;
  ref: string;
  url: string;
}

export interface TaskDependencySourceMetadata {
  provider: "linear";
  id: string;
  ref: string;
}

export interface TaskDocFrontmatter extends Record<string, unknown> {
  id?: string;
  title: string;
  status: string;
  created?: string;
  changePath?: string;
  priority?: string;
  tags?: string[];
  assignee?: string | null;
  dependencies?: string[];
  branch?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  source?: TaskSourceMetadata;
  dependencySources?: TaskDependencySourceMetadata[];
  dependencyImported?: boolean;
}

export interface TaskDoc {
  id: string | null;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  branch: string | null;
  changePath: string | null;
  description: string;
  requirements: string;
  acceptanceCriteria: Array<{ text: string; checked: boolean }>;
  source: TaskSourceMetadata | null;
  dependencySources: TaskDependencySourceMetadata[];
  dependencyImported: boolean;
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
