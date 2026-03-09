import { EventEmitter } from "node:events";
import type {
  SSETask,
  SSETaskCreatedEvent,
  SSETaskRemovedEvent,
  SSETaskStatusChangedEvent,
} from "@aop/common";

export type TaskEventType = "task-created" | "task-status-changed" | "task-removed";

export type TaskCreatedEvent = SSETaskCreatedEvent;
export type TaskStatusChangedEvent = SSETaskStatusChangedEvent;
export type TaskRemovedEvent = SSETaskRemovedEvent;

export type TaskEvent = TaskCreatedEvent | TaskStatusChangedEvent | TaskRemovedEvent;

export type { SSETask };

export interface TaskEventEmitter {
  emit: (event: TaskEvent) => void;
  subscribe: (listener: (event: TaskEvent) => void) => () => void;
  listenerCount: () => number;
}

export const createTaskEventEmitter = (): TaskEventEmitter => {
  const emitter = new EventEmitter();
  // Allow up to 50 concurrent SSE connections (dashboard tabs, API clients)
  // before warning. Each connection adds one listener.
  emitter.setMaxListeners(50);
  const EVENT_NAME = "task";

  return {
    emit: (event: TaskEvent): void => {
      emitter.emit(EVENT_NAME, event);
    },

    subscribe: (listener: (event: TaskEvent) => void): (() => void) => {
      emitter.on(EVENT_NAME, listener);
      return () => {
        emitter.off(EVENT_NAME, listener);
      };
    },

    listenerCount: (): number => {
      return emitter.listenerCount(EVENT_NAME);
    },
  };
};

let globalEmitter: TaskEventEmitter | null = null;

export const getTaskEventEmitter = (): TaskEventEmitter => {
  if (!globalEmitter) {
    globalEmitter = createTaskEventEmitter();
  }
  return globalEmitter;
};

export const resetTaskEventEmitter = (): void => {
  globalEmitter = null;
};
