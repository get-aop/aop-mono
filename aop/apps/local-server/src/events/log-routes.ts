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

      const sendEvent = async (data: SSEEventData) => {
        await stream.writeSSE({
          data: JSON.stringify(data),
          event: "message",
          id: String(eventId++),
        });
      };

      const existingLines = ctx.logBuffer.getLines(executionId);
      if (existingLines.length > 0) {
        await sendEvent({ type: "replay", lines: existingLines });
      }

      if (ctx.logBuffer.isComplete(executionId)) {
        const status = ctx.logBuffer.getStatus(executionId);
        if (status) {
          await sendEvent({ type: "complete", status });
        }
        return;
      }

      const unsubscribeLog = ctx.logBuffer.subscribe(async (event: LogEvent) => {
        if (event.executionId !== executionId) return;
        await sendEvent({
          type: "log",
          stream: event.line.stream,
          content: event.line.content,
          timestamp: event.line.timestamp,
        });
      });

      const unsubscribeComplete = ctx.logBuffer.subscribeComplete(
        async (event: ExecutionCompleteEvent) => {
          if (event.executionId !== executionId) return;
          await sendEvent({ type: "complete", status: event.status });
          stream.close();
        },
      );

      stream.onAbort(() => {
        unsubscribeLog();
        unsubscribeComplete();
      });

      await new Promise(() => {});
    });
  };
};
