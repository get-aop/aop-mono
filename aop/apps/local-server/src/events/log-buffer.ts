import { EventEmitter } from "node:events";

export interface LogEvent {
  stepExecutionId: string;
  line: string;
}

export interface StepCompleteEvent {
  stepExecutionId: string;
  status: "completed" | "failed" | "cancelled";
}

const MAX_BUFFER_SIZE = 500;

export interface LogBuffer {
  push: (stepExecutionId: string, rawLine: string) => void;
  getLines: (stepExecutionId: string) => string[];
  markComplete: (stepExecutionId: string, status: StepCompleteEvent["status"]) => void;
  isComplete: (stepExecutionId: string) => boolean;
  getStatus: (stepExecutionId: string) => StepCompleteEvent["status"] | null;
  subscribe: (listener: (event: LogEvent) => void) => () => void;
  subscribeComplete: (listener: (event: StepCompleteEvent) => void) => () => void;
  clear: (stepExecutionId: string) => void;
}

export const createLogBuffer = (): LogBuffer => {
  const buffers = new Map<string, string[]>();
  const completionStatus = new Map<string, StepCompleteEvent["status"]>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const LOG_EVENT = "log";
  const COMPLETE_EVENT = "complete";

  return {
    push: (stepExecutionId: string, rawLine: string): void => {
      let buffer = buffers.get(stepExecutionId);
      if (!buffer) {
        buffer = [];
        buffers.set(stepExecutionId, buffer);
      }

      buffer.push(rawLine);

      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
      }

      emitter.emit(LOG_EVENT, { stepExecutionId, line: rawLine });
    },

    getLines: (stepExecutionId: string): string[] => {
      return buffers.get(stepExecutionId) ?? [];
    },

    markComplete: (stepExecutionId: string, status: StepCompleteEvent["status"]): void => {
      completionStatus.set(stepExecutionId, status);
      emitter.emit(COMPLETE_EVENT, { stepExecutionId, status });
    },

    isComplete: (stepExecutionId: string): boolean => {
      return completionStatus.has(stepExecutionId);
    },

    getStatus: (stepExecutionId: string): StepCompleteEvent["status"] | null => {
      return completionStatus.get(stepExecutionId) ?? null;
    },

    subscribe: (listener: (event: LogEvent) => void): (() => void) => {
      emitter.on(LOG_EVENT, listener);
      return () => emitter.off(LOG_EVENT, listener);
    },

    subscribeComplete: (listener: (event: StepCompleteEvent) => void): (() => void) => {
      emitter.on(COMPLETE_EVENT, listener);
      return () => emitter.off(COMPLETE_EVENT, listener);
    },

    clear: (stepExecutionId: string): void => {
      buffers.delete(stepExecutionId);
      completionStatus.delete(stepExecutionId);
    },
  };
};

let globalLogBuffer: LogBuffer | null = null;

export const getLogBuffer = (): LogBuffer => {
  if (!globalLogBuffer) {
    globalLogBuffer = createLogBuffer();
  }
  return globalLogBuffer;
};

export const resetLogBuffer = (): void => {
  globalLogBuffer = null;
};
