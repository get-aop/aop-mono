import { getLogger } from "@aop/infra";
import { readLogLines } from "../events/log-file-tailer.ts";
import type { ExecutionRepository } from "./execution-repository.ts";

const logger = getLogger("executor", "log-flusher");

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

export interface LogFlusher {
  track: (stepExecutionId: string, logFile: string) => void;
  finalFlush: (stepExecutionId: string) => Promise<void>;
  start: () => void;
  stop: () => void;
}

export interface LogFlusherConfig {
  flushIntervalMs?: number;
}

interface TrackedStep {
  logFile: string;
  flushedLineCount: number;
}

export const createLogFlusher = (
  executionRepository: ExecutionRepository,
  config?: LogFlusherConfig,
): LogFlusher => {
  const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const tracked = new Map<string, TrackedStep>();
  let timer: Timer | undefined;

  const flushStep = async (stepExecutionId: string, entry: TrackedStep): Promise<void> => {
    const { lines } = readLogLines(entry.logFile, entry.flushedLineCount);
    if (lines.length === 0) return;

    const now = new Date().toISOString();
    const logs = lines.map((content) => ({
      step_execution_id: stepExecutionId,
      content,
      created_at: now,
    }));

    try {
      await executionRepository.saveStepLogs(logs);
      entry.flushedLineCount += lines.length;
      logger.debug("Flushed {count} log lines for step {stepId}", {
        count: lines.length,
        stepId: stepExecutionId,
      });
    } catch (err) {
      logger.warn("Failed to flush logs for step {stepId}: {error}", {
        stepId: stepExecutionId,
        error: String(err),
      });
    }
  };

  const tick = async (): Promise<void> => {
    const entries = [...tracked.entries()];
    for (const [stepId, entry] of entries) {
      await flushStep(stepId, entry);
    }
  };

  return {
    track: (stepExecutionId, logFile) => {
      tracked.set(stepExecutionId, { logFile, flushedLineCount: 0 });
      logger.debug("Tracking step {stepId} for periodic log flushing", {
        stepId: stepExecutionId,
      });
    },

    finalFlush: async (stepExecutionId) => {
      const entry = tracked.get(stepExecutionId);
      if (!entry) return;

      await flushStep(stepExecutionId, entry);
      tracked.delete(stepExecutionId);
    },

    start: () => {
      if (timer) return;
      timer = setInterval(() => void tick(), flushIntervalMs);
      logger.info("Log flusher started with {interval}ms interval", {
        interval: flushIntervalMs,
      });
    },

    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      tracked.clear();
      logger.info("Log flusher stopped");
    },
  };
};
