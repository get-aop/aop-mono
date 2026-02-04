import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import type { ExecutionCompleteEvent, LogEvent, LogLine } from "./log-buffer.ts";

interface LogSSEEvent {
  type: "log";
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

interface ReplaySSEEvent {
  type: "replay";
  lines: LogLine[];
}

interface CompleteSSEEvent {
  type: "complete";
  status: "completed" | "failed" | "cancelled";
}

type SSEEventData = LogSSEEvent | ReplaySSEEvent | CompleteSSEEvent;

const mapExecutionStatus = (status: string): "completed" | "failed" | "cancelled" => {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "aborted") return "cancelled";
  return "failed";
};

export const createLogStreamHandler = (ctx: LocalServerContext) => {
  return async (c: Context) => {
    const executionId = c.req.param("executionId");

    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    const isCompleted = execution.status !== "running";

    if (isCompleted) {
      return streamSSE(c, async (stream) => {
        let eventId = 0;

        const sendEvent = async (data: SSEEventData) => {
          await stream.writeSSE({
            data: JSON.stringify(data),
            event: "message",
            id: String(eventId++),
          });
        };

        const persistedLogs = await ctx.executionRepository.getExecutionLogs(executionId);
        if (persistedLogs.length > 0) {
          const lines: LogLine[] = persistedLogs.map((log) => ({
            stream: log.stream,
            content: log.content,
            timestamp: log.timestamp,
          }));
          await sendEvent({ type: "replay", lines });
        }

        await sendEvent({ type: "complete", status: mapExecutionStatus(execution.status) });
      });
    }

    return streamSSE(c, async (stream) => {
      let eventId = 0;
      let completionHandled = false;

      const sendEvent = async (data: SSEEventData) => {
        await stream.writeSSE({
          data: JSON.stringify(data),
          event: "message",
          id: String(eventId++),
        });
      };

      let unsubscribeLog: (() => void) | null = null;
      let unsubscribeComplete: (() => void) | null = null;

      const cleanup = () => {
        unsubscribeLog?.();
        unsubscribeComplete?.();
        unsubscribeLog = null;
        unsubscribeComplete = null;
      };

      const handleCompletion = (status: "completed" | "failed" | "cancelled") => {
        if (completionHandled) return;
        completionHandled = true;
        cleanup();
        sendEvent({ type: "complete", status }).finally(() => {
          stream.close();
        });
      };

      // Subscribe BEFORE checking isComplete to avoid race condition:
      // If we check first and completion happens between check and subscribe,
      // we miss the event and listeners leak forever.
      unsubscribeLog = ctx.logBuffer.subscribe(async (event: LogEvent) => {
        if (event.executionId !== executionId) return;
        await sendEvent({
          type: "log",
          stream: event.line.stream,
          content: event.line.content,
          timestamp: event.line.timestamp,
        });
      });

      unsubscribeComplete = ctx.logBuffer.subscribeComplete((event: ExecutionCompleteEvent) => {
        if (event.executionId !== executionId) return;
        handleCompletion(event.status);
      });

      stream.onAbort(cleanup);

      // Send replay of existing lines AFTER subscribing, so we don't miss
      // any events that arrive between getLines and subscribe
      const existingLines = ctx.logBuffer.getLines(executionId);
      if (existingLines.length > 0) {
        await sendEvent({ type: "replay", lines: existingLines });
      }

      // Check if completion happened before or during subscription setup.
      // getStatus returns null if not complete, so we use it directly.
      const existingStatus = ctx.logBuffer.getStatus(executionId);
      if (existingStatus && !completionHandled) {
        completionHandled = true;
        cleanup();
        await sendEvent({ type: "complete", status: existingStatus });
        stream.close();
        return;
      }

      await new Promise(() => {});
    });
  };
};
