import { useMemo } from "react";
import type { ConnectionState, Task } from "../types";

export interface UseConnectionStatusOptions {
  connected: boolean;
  tasks: Task[];
}

export const useConnectionStatus = (options: UseConnectionStatusOptions): ConnectionState => {
  const { connected, tasks } = options;

  return useMemo(() => {
    if (!connected) {
      return "disconnected";
    }

    const hasWorkingTasks = tasks.some((task) => task.status === "WORKING");
    return hasWorkingTasks ? "working" : "idle";
  }, [connected, tasks]);
};
