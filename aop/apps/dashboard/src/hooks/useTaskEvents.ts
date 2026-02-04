import { useCallback, useEffect, useRef, useState } from "react";
import { createTaskEventsConnection, type TaskEvent } from "../api/events";
import type { Task } from "../types";

export interface TaskEventsState {
  tasks: Task[];
  capacity: { working: number; max: number };
  repos: { id: string; name: string | null; path: string }[];
  connected: boolean;
  initialized: boolean;
}

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

  return state;
};
