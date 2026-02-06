import type {
  DashboardEvent,
  DashboardHeartbeatEvent,
  DashboardInitEvent,
  DashboardTask,
  DashboardTaskCreatedEvent,
  DashboardTaskRemovedEvent,
  DashboardTaskStatusChangedEvent,
  SSEEventType,
  SSEInitEvent,
  SSERepoWithTasks,
  SSETask,
  SSETaskCreatedEvent,
  SSETaskRemovedEvent,
  SSETaskStatusChangedEvent,
} from "@aop/common";

export type { SSEEventType as TaskEventType };
export type TaskEvent = DashboardEvent;
export type InitEvent = DashboardInitEvent;
export type TaskCreatedEvent = DashboardTaskCreatedEvent;
export type TaskStatusChangedEvent = DashboardTaskStatusChangedEvent;
export type TaskRemovedEvent = DashboardTaskRemovedEvent;
export type HeartbeatEvent = DashboardHeartbeatEvent;

export interface TaskEventsOptions {
  onEvent: (event: TaskEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

const MIN_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

const sseTaskToDashboardTask = (sseTask: SSETask, repoPath: string): DashboardTask => ({
  ...sseTask,
  repoPath,
});

export const createTaskEventsConnection = (options: TaskEventsOptions) => {
  let eventSource: EventSource | null = null;
  let retryCount = 0;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let repoPathMap = new Map<string, string>();

  const getRetryDelay = () => {
    const delay = Math.min(MIN_RETRY_DELAY * 2 ** retryCount, MAX_RETRY_DELAY);
    return delay + Math.random() * 1000;
  };

  const parseEvent = (eventType: string, data: string): TaskEvent | null => {
    try {
      const parsed = JSON.parse(data);
      switch (eventType) {
        case "init": {
          const backendEvent = parsed as SSEInitEvent;
          const status = backendEvent.status;
          repoPathMap = new Map(status.repos.map((r: SSERepoWithTasks) => [r.id, r.path]));
          const tasks = status.repos.flatMap((repo: SSERepoWithTasks) =>
            repo.tasks.map((t: SSETask) => sseTaskToDashboardTask(t, repo.path)),
          );
          const repos = status.repos.map((repo: SSERepoWithTasks) => ({
            id: repo.id,
            name: repo.name,
            path: repo.path,
          }));
          return {
            type: "init",
            data: { tasks, capacity: status.globalCapacity, repos },
          };
        }
        case "task-created": {
          const backendEvent = parsed as SSETaskCreatedEvent;
          // Defensive: If task or required fields are missing, skip the event
          if (!backendEvent.task?.changePath) {
            return null;
          }
          const repoPath = repoPathMap.get(backendEvent.task.repoId) ?? "";
          return {
            type: "task-created",
            data: { task: sseTaskToDashboardTask(backendEvent.task, repoPath) },
          };
        }
        case "task-status-changed": {
          const backendEvent = parsed as SSETaskStatusChangedEvent;
          return {
            type: "task-status-changed",
            data: {
              taskId: backendEvent.taskId,
              status: backendEvent.newStatus,
              updatedAt: backendEvent.task.updatedAt,
              errorMessage: backendEvent.task.errorMessage,
              currentExecutionId: backendEvent.task.currentExecutionId,
              executionStartedAt: backendEvent.task.executionStartedAt,
              executionCompletedAt: backendEvent.task.executionCompletedAt,
            },
          };
        }
        case "task-removed": {
          const backendEvent = parsed as SSETaskRemovedEvent;
          return { type: "task-removed", data: { taskId: backendEvent.taskId } };
        }
        case "heartbeat":
          return { type: "heartbeat", data: parsed };
        default:
          return null;
      }
    } catch {
      options.onError?.(new Error(`Failed to parse SSE event: ${data}`));
      return null;
    }
  };

  const connect = () => {
    if (closed) return;

    eventSource = new EventSource("/api/events");

    eventSource.onopen = () => {
      retryCount = 0;
      options.onConnect?.();
    };

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      options.onDisconnect?.();

      if (!closed) {
        const delay = getRetryDelay();
        retryCount++;
        retryTimeout = setTimeout(connect, delay);
      }
    };

    const eventTypes: SSEEventType[] = [
      "init",
      "task-created",
      "task-status-changed",
      "task-removed",
      "heartbeat",
    ];
    for (const type of eventTypes) {
      eventSource.addEventListener(type, (e) => {
        const event = parseEvent(type, (e as MessageEvent).data);
        if (event) {
          options.onEvent(event);
        }
      });
    }
  };

  const close = () => {
    closed = true;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };

  connect();

  return { close };
};
