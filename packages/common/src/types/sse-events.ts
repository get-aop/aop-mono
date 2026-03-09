import type { TaskStatus } from "./task";

/**
 * SSE Task representation for wire protocol.
 * Uses camelCase and string dates for JSON serialization.
 */
export interface SSETask {
  id: string;
  repoId: string;
  changePath: string;
  status: TaskStatus;
  baseBranch: string | null;
  preferredProvider: string | null;
  preferredWorkflow: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  currentExecutionId?: string;
  executionStartedAt?: string;
  executionCompletedAt?: string;
  taskProgress?: { completed: number; total: number };
}

/**
 * Dashboard-friendly task with resolved repoPath.
 * Extends SSETask with the path needed for UI display.
 */
export interface DashboardTask extends SSETask {
  repoPath: string;
}

export interface SSERepo {
  id: string;
  name: string | null;
  path: string;
}

export interface SSERepoWithTasks extends SSERepo {
  working: number;
  max: number;
  tasks: SSETask[];
}

export interface SSECapacity {
  working: number;
  max: number;
}

export interface SSEServerStatus {
  globalCapacity: SSECapacity;
  repos: SSERepoWithTasks[];
}

export type SSEEventType =
  | "init"
  | "task-created"
  | "task-status-changed"
  | "task-removed"
  | "heartbeat";

export interface SSEInitEvent {
  type: "init";
  status: SSEServerStatus;
}

export interface SSETaskCreatedEvent {
  type: "task-created";
  task: SSETask;
}

export interface SSETaskStatusChangedEvent {
  type: "task-status-changed";
  taskId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  task: SSETask;
}

export interface SSETaskRemovedEvent {
  type: "task-removed";
  taskId: string;
  task: SSETask;
}

export interface SSEHeartbeatEvent {
  type: "heartbeat";
  timestamp: string;
}

export type SSEEvent =
  | SSEInitEvent
  | SSETaskCreatedEvent
  | SSETaskStatusChangedEvent
  | SSETaskRemovedEvent
  | SSEHeartbeatEvent;

/**
 * Dashboard-specific event types with resolved repoPath on tasks.
 * Used by the frontend after transforming wire events.
 */
export interface DashboardInitEvent {
  type: "init";
  data: {
    tasks: DashboardTask[];
    capacity: SSECapacity;
    repos: SSERepo[];
  };
}

export interface DashboardTaskCreatedEvent {
  type: "task-created";
  data: { task: DashboardTask };
}

export interface DashboardTaskStatusChangedEvent {
  type: "task-status-changed";
  data: {
    taskId: string;
    status: TaskStatus;
    updatedAt: string;
    errorMessage?: string;
    currentExecutionId?: string;
    executionStartedAt?: string;
    executionCompletedAt?: string;
    taskProgress?: { completed: number; total: number };
  };
}

export interface DashboardTaskRemovedEvent {
  type: "task-removed";
  data: { taskId: string };
}

export interface DashboardHeartbeatEvent {
  type: "heartbeat";
  data: { timestamp: string };
}

export type DashboardEvent =
  | DashboardInitEvent
  | DashboardTaskCreatedEvent
  | DashboardTaskStatusChangedEvent
  | DashboardTaskRemovedEvent
  | DashboardHeartbeatEvent;
