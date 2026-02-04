import type { DashboardTask, TaskStatus } from "@aop/common";

export type Task = DashboardTask;

export interface Repo {
  id: string;
  path: string;
  name: string;
}

export type StepStatus = "running" | "success" | "failure" | "cancelled";

export interface Step {
  id: string;
  stepType: string | null;
  status: StepStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface Execution {
  id: string;
  taskId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  steps: Step[];
}

export interface Metrics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
}

export type ConnectionState = "disconnected" | "idle" | "working";
