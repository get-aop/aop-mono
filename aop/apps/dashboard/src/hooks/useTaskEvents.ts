import { useCallback, useEffect, useRef, useState } from "react";
import { getStatus } from "../api/client";
import { createTaskEventsConnection, type TaskEvent } from "../api/events";
import type { Task } from "../types";

export interface TaskEventsState {
  tasks: Task[];
  capacity: { working: number; max: number };
  repos: { id: string; name: string | null; path: string }[];
  connected: boolean;
  initialized: boolean;
}

const WORKING_STATUS_POLL_INTERVAL_MS = 2000;

export const useTaskEvents = () => {
  const [state, setState] = useState<TaskEventsState>({
    tasks: [],
    capacity: { working: 0, max: 0 },
    repos: [],
    connected: false,
    initialized: false,
  });

  const connectionRef = useRef<{ close: () => void } | null>(null);

  const handleEvent = useCallback((event: TaskEvent) => {
    switch (event.type) {
      case "init":
        setState((prev) => ({
          ...prev,
          tasks: event.data.tasks,
          capacity: event.data.capacity,
          repos: event.data.repos,
          initialized: true,
        }));
        break;

      case "task-created":
        setState((prev) => ({
          ...prev,
          tasks: [...prev.tasks, event.data.task],
        }));
        break;

      case "task-status-changed":
        setState((prev) => ({
          ...prev,
          tasks: prev.tasks.map((task) =>
            task.id === event.data.taskId
              ? {
                  ...task,
                  status: event.data.status,
                  updatedAt: event.data.updatedAt,
                  errorMessage: event.data.errorMessage,
                  currentExecutionId: event.data.currentExecutionId,
                  executionStartedAt: event.data.executionStartedAt,
                  executionCompletedAt: event.data.executionCompletedAt,
                  taskProgress: event.data.taskProgress,
                }
              : task,
          ),
          capacity:
            event.data.status === "WORKING"
              ? { ...prev.capacity, working: prev.capacity.working + 1 }
              : prev.tasks.find((t) => t.id === event.data.taskId)?.status === "WORKING"
                ? { ...prev.capacity, working: Math.max(0, prev.capacity.working - 1) }
                : prev.capacity,
        }));
        break;

      case "task-removed":
        setState((prev) => {
          const removedTask = prev.tasks.find((t) => t.id === event.data.taskId);
          return {
            ...prev,
            tasks: prev.tasks.filter((task) => task.id !== event.data.taskId),
            capacity:
              removedTask?.status === "WORKING"
                ? { ...prev.capacity, working: Math.max(0, prev.capacity.working - 1) }
                : prev.capacity,
          };
        });
        break;
    }
  }, []);

  const handleConnect = useCallback(() => {
    setState((prev) => ({ ...prev, connected: true }));
  }, []);

  const handleDisconnect = useCallback(() => {
    setState((prev) => ({ ...prev, connected: false }));
  }, []);

  useEffect(() => {
    connectionRef.current = createTaskEventsConnection({
      onEvent: handleEvent,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
    });

    return () => {
      connectionRef.current?.close();
    };
  }, [handleEvent, handleConnect, handleDisconnect]);

  const refresh = useCallback(async () => {
    const status = await getStatus();
    setState((prev) => ({
      ...prev,
      tasks: status.tasks,
      capacity: status.capacity,
      repos: status.repos,
    }));
  }, []);

  const hasWorkingTasks = state.tasks.some((task) => task.status === "WORKING");
  useEffect(() => {
    if (!hasWorkingTasks) return;

    // Task progress is derived from files and can change while status remains WORKING.
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, WORKING_STATUS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasWorkingTasks, refresh]);

  return { ...state, refresh };
};
