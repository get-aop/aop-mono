import { EventEmitter } from "node:events";

export interface LogLine {
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

export interface LogEvent {
  executionId: string;
  line: LogLine;
}

export interface ExecutionCompleteEvent {
  executionId: string;
  status: "completed" | "failed" | "cancelled";
}

const MAX_BUFFER_SIZE = 500;

export interface LogBuffer {
  push: (executionId: string, line: LogLine) => void;
  getLines: (executionId: string) => LogLine[];
  markComplete: (executionId: string, status: ExecutionCompleteEvent["status"]) => void;
  isComplete: (executionId: string) => boolean;
  getStatus: (executionId: string) => ExecutionCompleteEvent["status"] | null;
  subscribe: (listener: (event: LogEvent) => void) => () => void;
  subscribeComplete: (listener: (event: ExecutionCompleteEvent) => void) => () => void;
  clear: (executionId: string) => void;
}

export const createLogBuffer = (): LogBuffer => {
  const buffers = new Map<string, LogLine[]>();
  const completionStatus = new Map<string, ExecutionCompleteEvent["status"]>();
  const emitter = new EventEmitter();

  const LOG_EVENT = "log";
  const COMPLETE_EVENT = "complete";

  return {
    push: (executionId: string, line: LogLine): void => {
      let buffer = buffers.get(executionId);
      if (!buffer) {
        buffer = [];
        buffers.set(executionId, buffer);
      }

      buffer.push(line);

      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
      }

      emitter.emit(LOG_EVENT, { executionId, line });
    },

    getLines: (executionId: string): LogLine[] => {
      return buffers.get(executionId) ?? [];
    },

    markComplete: (executionId: string, status: ExecutionCompleteEvent["status"]): void => {
      completionStatus.set(executionId, status);
      emitter.emit(COMPLETE_EVENT, { executionId, status });
    },

    isComplete: (executionId: string): boolean => {
      return completionStatus.has(executionId);
    },

    getStatus: (executionId: string): ExecutionCompleteEvent["status"] | null => {
      return completionStatus.get(executionId) ?? null;
    },

    subscribe: (listener: (event: LogEvent) => void): (() => void) => {
      emitter.on(LOG_EVENT, listener);
      return () => emitter.off(LOG_EVENT, listener);
    },

    subscribeComplete: (listener: (event: ExecutionCompleteEvent) => void): (() => void) => {
      emitter.on(COMPLETE_EVENT, listener);
      return () => emitter.off(COMPLETE_EVENT, listener);
    },

    clear: (executionId: string): void => {
      buffers.delete(executionId);
      completionStatus.delete(executionId);
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
