import type { DashboardTask, TaskStatus } from "@aop/common";

export type Task = DashboardTask;

export interface Repo {
  id: string;
  path: string;
  name: string;
}

export interface Execution {
  id: string;
  taskId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
}

export interface Metrics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
}

export type ConnectionState = "disconnected" | "idle" | "working";
